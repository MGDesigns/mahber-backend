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
// DATABASE CONNECTIE
// ----------------------------------------
const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false } // Render/Postgres vereist SSL
});

// ----------------------------------------
// LEEFTIJD CHECK
// ----------------------------------------
function calculateAge(birth) {
  const today = new Date();
  const d = new Date(birth);
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

// ----------------------------------------
// PDF FACTUUR GENERATOR
// ----------------------------------------
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
    if (member.email) doc.text(`E-mail: ${member.email}`);
    if (member.phone) doc.text(`Telefoon: ${member.phone}`);
    if (member.street || member.postal_code || member.city) {
      doc.moveDown();
      doc.text("Adres:");
      if (member.street) doc.text(member.street);
      let line = "";
      if (member.postal_code) line += member.postal_code + " ";
      if (member.city) line += member.city;
      if (line) doc.text(line);
    }

    doc.moveDown();
    doc.text("Bedrag: €50");
    doc.text("Omschrijving: Jaarlijks lidmaatschap Mahber");

    doc.end();

    stream.on("finish", () => resolve(filePath));
  });
}

// ----------------------------------------
// REGISTRATIE ENDPOINT
// ----------------------------------------
app.post("/register", async (req, res) => {
  const data = req.body;

  try {
    // 1) Leeftijdscontrole
    if (!data.birth_date) {
      return res.status(400).json({ message: "Geboortedatum ontbreekt." });
    }

    if (calculateAge(data.birth_date) >= 65) {
      return res.status(400).json({
        message: "Inschrijving niet toegestaan: leeftijdsgrens 65 jaar bereikt."
      });
    }

    // 2) Nieuwe sequence-waarde uit database halen (altijd uniek)
    const seqResult = await pool.query(
      "SELECT nextval('member_seq') AS seq"
    );
    const seq = seqResult.rows[0].seq;
    const year = new Date().getFullYear();
    const finalMemberId = `M${seq}-${year}`;

    // 3) Member opslaan in database
    // Let op: we mappen 'street' naar kolom 'address' in je tabel
    const isMarried = !!data.is_married;
    const hasChildren = !!data.has_children;

    await pool.query(
      `INSERT INTO members 
       (member_id, seq_id, first_name, last_name, gender, birth_date, birth_place, 
        email, phone, address, postal_code, city, address_extra, is_married, has_children, created_at)
       VALUES 
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())`,
      [
        finalMemberId,
        seq,
        data.first_name,
        data.last_name,
        data.gender || null,
        data.birth_date,
        data.birth_place || null,
        data.email,
        data.phone || null,
        data.street || null,       // => address
        data.postal_code || null,
        data.city || null,
        data.address_extra || null,
        isMarried,
        hasChildren
      ]
    );

    // (Optioneel: later spouses/children/emergency toevoegen zodra frontend JSON-structuur duidelijk is)

    // 4) Factuur PDF genereren
    const pdfPath = await createInvoicePDF(data, finalMemberId);
    const pdfBuffer = fs.readFileSync(pdfPath);
    const base64Pdf = pdfBuffer.toString("base64");

    // 5) Email versturen via Brevo API (met bijlage)
    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "Mahber", email: "info@mahber.be" },
        to: [{ email: data.email }],
        cc: [{ email: "info@mahber.be" }],
        subject: "Welkom bij Mahber – Uw lidnummer & factuur",
        textContent: `
Beste ${data.first_name},

Bedankt voor uw registratie bij Mahber.

Uw lidnummer is:
${finalMemberId}

In de bijlage vindt u uw factuur voor het lidmaatschap.

Met respect,
Team Mahber
`,
        attachments: [
          {
            name: `factuur_${finalMemberId}.pdf`,
            content: base64Pdf
          }
        ]
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    // Optioneel: tijdelijke file opruimen
    try {
      fs.unlinkSync(pdfPath);
    } catch (e) {
      console.warn("Kon tijdelijke PDF niet verwijderen:", e.message);
    }

    // 6) Response naar frontend
    res.json({
      message: "Registratie succesvol! E-mail + factuur verzonden.",
      memberId: finalMemberId
    });

  } catch (err) {
    console.error("REGISTRATIE FOUT:", err.response?.data || err);
    res.status(500).json({ message: "Serverfout bij registratie of e-mail." });
  }
});

// ----------------------------------------
// SERVER STARTEN
// ----------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Mahber API draait op poort " + PORT);
});
