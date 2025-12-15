import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import pkg from "pg";
import PDFDocument from "pdfkit";
import fs from "fs";

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------------------------
// DATABASE
// ----------------------------------------
const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false }
});

// ----------------------------------------
// HULPFUNCTIES
// ----------------------------------------
function calculateAge(birth) {
  const today = new Date();
  const d = new Date(birth);
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function createInvoicePDF(member, memberId) {
  return new Promise((resolve) => {
    const filePath = `/tmp/factuur_${memberId}.pdf`;
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);
    doc.fontSize(22).text("Mahber — Lidmaatschapsfactuur", { underline: true });
    doc.moveDown();
    doc.fontSize(14).text(`Lidnummer: ${memberId}`);
    doc.text(`Naam: ${member.first_name} ${member.last_name}`);
    doc.text("Bedrag: €50");
    doc.text("Omschrijving: Jaarlijks lidmaatschap Mahber");
    doc.end();

    stream.on("finish", () => resolve(filePath));
  });
}

// ----------------------------------------
// REGISTRATIE
// ----------------------------------------
app.post("/register", async (req, res) => {
  const data = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Leeftijd
    if (calculateAge(data.birth_date) >= 65) {
      throw new Error("Leeftijdsgrens overschreden");
    }

    // Lidnummer
    const seqResult = await client.query(
      "SELECT nextval('member_seq') AS seq"
    );
    const seq = seqResult.rows[0].seq;
    const memberCode = `M${seq}-${new Date().getFullYear()}`;

    // -------------------------
    // MEMBER (1 PER GEZIN)
    // -------------------------
    const memberResult = await client.query(
      `INSERT INTO members
       (member_id, seq_id, first_name, last_name, gender, birth_date,
        birth_place, email, phone, address, postal_code, city,
        address_extra, is_married, has_children, created_at)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       RETURNING id`,
      [
        memberCode,
        seq,
        data.first_name,
        data.last_name,
        data.gender,
        data.birth_date,
        data.birth_place,
        data.email,
        data.phone,
        data.street,
        data.postal_code,
        data.city,
        data.address_extra,
        !!data.is_married,
        !!data.has_children
      ]
    );

    const memberDbId = memberResult.rows[0].id;

    // -------------------------
    // SPOUSE (optioneel)
    // -------------------------
    if (data.is_married) {
      await client.query(
        `INSERT INTO spouses
         (member_id, first_name, last_name, gender, birth_date, birth_place, email, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          memberDbId,
          data.partner_first_name,
          data.partner_last_name,
          data.partner_gender,
          data.partner_birth_date,
          data.partner_birth_place,
          data.partner_email,
          data.partner_phone
        ]
      );
    }

    // -------------------------
    // CHILDREN (0..n)
    // -------------------------
    if (Array.isArray(data.children)) {
      for (const child of data.children) {
        await client.query(
          `INSERT INTO children
           (member_id, first_name, last_name, gender, birth_date, birth_place)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            memberDbId,
            child.first_name,
            child.last_name,
            child.gender,
            child.birth_date,
            child.birth_place
          ]
        );
      }
    }

    // -------------------------
    // EMERGENCY (verplicht)
    // -------------------------
    await client.query(
      `INSERT INTO emergencies
       (member_id, first_name, last_name, phone)
       VALUES ($1,$2,$3,$4)`,
      [
        memberDbId,
        data.emergency_first_name,
        data.emergency_last_name,
        data.emergency_phone
      ]
    );

    // -------------------------
    // FACTUUR + MAIL
    // -------------------------
    const pdfPath = await createInvoicePDF(data, memberCode);
    const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "Mahber", email: "info@mahber.be" },
        to: [{ email: data.email }],
        subject: "Welkom bij Mahber – Lidnummer & factuur",
        textContent: `Uw lidnummer is ${memberCode}`,
        attachments: [{ name: "factuur.pdf", content: pdfBase64 }]
      },
      { headers: { "api-key": process.env.BREVO_API_KEY } }
    );

    await client.query("COMMIT");

    res.json({
      message: "Registratie succesvol (gezin gekoppeld aan 1 lidnummer)",
      memberId: memberCode
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Registratie mislukt" });
  } finally {
    client.release();
  }
});

// ----------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log("Mahber API draait op poort " + PORT)
);
