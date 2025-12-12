import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

let counter = 1000; // ⚠️ Later vervangen door database

// ✅ Leeftijd correct berekenen
function calculateAge(birth) {
  const today = new Date();
  const birthDate = new Date(birth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

app.post("/register", async (req, res) => {
  try {
    const data = req.body;

    // ✅ Leeftijdscontrole 65+
    const age = calculateAge(data.birth_date);
    if (age >= 65) {
      return res.status(400).json({
        message: "Inschrijving niet toegestaan: leeftijdsgrens 65 jaar bereikt."
      });
    }

    // ✅ Lidnummer correct formaat
    const year = new Date().getFullYear();
    const memberId = `M${counter++}-${year}`;

    // ✅ Mail versturen via BREVO API (geen SMTP meer!)
    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "Mahber", email: "info@mahber.be" },
        to: [{ email: data.email }],
        cc: [{ email: "info@mahber.be" }],
        subject: "Welkom bij Mahber – Uw lidnummer",
        textContent: `
Beste ${data.first_name},

Dank voor uw registratie bij Mahber.

Uw lidnummer is:
${memberId}

Met respect,
Team Mahber
`
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      message: "Registratie succesvol! Controleer uw e-mail.",
      memberId
    });

  } catch (err) {
    console.error("MAIL ERROR:", err.response?.data || err);
    res.status(500).json({ message: "Serverfout bij verzending e-mail" });
  }
});

// ✅ Render correcte poort
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Mahber API draait op poort " + PORT);
});
import "dotenv/config";
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
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
  ssl: { rejectUnauthorized: false }
});

// ----------------------------------------
// BREVO SMTP TRANSPORT
// ----------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: { rejectUnauthorized: false }
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
    doc.text(`E-mail: ${member.email}`);
    doc.text(`Telefoon: ${member.phone}`);
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
    // Leeftijd controleren
    if (calculateAge(data.birth_date) >= 65) {
      return res
        .status(400)
        .json({ message: "Leeftijdsgrens 65 jaar overschreden" });
    }

    // 1. MEMBER OPSLAAN
    const memberInsert = await pool.query(
      `INSERT INTO members 
       (first_name, last_name, gender, birth_date, birth_place, email, phone, street, postal_code, city, address_extra, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       RETURNING id, seq_id`,
      [
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
        data.address_extra
      ]
    );

    const memberId = memberInsert.rows[0].seq_id;
    const finalMemberId = `M${memberId}-${new Date().getFullYear()}`;
    const newMemberId = memberInsert.rows[0].id;

    // 2. PARTNER OPSLAAN
    if (data.is_married) {
      await pool.query(
        `INSERT INTO spouses 
        (member_id, first_name, last_name, gender, birth_date, birth_place, email, phone)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newMemberId,
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

    // 3. KINDEREN OPSLAAN
    if (data.children) {
      for (let c of Object.values(data.children)) {
        await pool.query(
          `INSERT INTO children 
           (member_id, first_name, last_name, gender, birth_date, birth_place)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            newMemberId,
            c.first_name,
            c.last_name,
            c.gender,
            c.birth_date,
            c.birth_place
          ]
        );
      }
    }

    // 4. NAASTE OPSLAAN
    if (data.emergency_first_name) {
      await pool.query(
        `INSERT INTO emergencies 
        (member_id, first_name, last_name, phone)
        VALUES ($1,$2,$3,$4)`,
        [
          newMemberId,
          data.emergency_first_name,
          data.emergency_last_name,
          data.emergency_phone
        ]
      );
    }

    // 5. PDF FACTUUR GENEREREN
    const pdfPath = await createInvoicePDF(data, finalMemberId);

    // 6. EMAIL VERSTUREN
    await transporter.sendMail({
      from: "Mahber <info@mahber.be>",
      to: data.email,
      cc: "info@mahber.be",
      subject: "Welkom bij Mahber – Uw lidnummer & factuur",
      text: `
Beste ${data.first_name},

Bedankt voor uw registratie bij Mahber.

Uw lidnummer: ${finalMemberId}

In bijlage vindt u uw factuur voor het lidmaatschap.

Met respect,  
Team Mahber
`,
      attachments: [
        {
          filename: `factuur_${finalMemberId}.pdf`,
          path: pdfPath
        }
      ]
    });

    res.json({
      message: "Registratie succesvol! Email + factuur verzonden.",
      memberId: finalMemberId
    });
  } catch (err) {
    console.error("FOUT:", err);
    res.status(500).json({ message: "Serverfout" });
  }
});

// ----------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Mahber API draait op poort " + PORT));
