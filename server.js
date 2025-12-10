import "dotenv/config";      // ✅ ENV correct inladen
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json());

let counter = 1000; // ⚠️ tijdelijk – dit hoort later in database

// ✅ BREVO SMTP CONFIG (GECORRIGEERD)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT), // ✅ nu correct nummer
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

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

    // ✅ Mail versturen via Brevo
    await transporter.sendMail({
      from: "Mahber <info@mahber.be>",
      to: data.email,
      cc: "info@mahber.be",
      subject: "Welkom bij Mahber – Uw lidnummer",
      text: `
Beste ${data.first_name},

Dank voor uw registratie bij Mahber.

Uw lidnummer is:
${memberId}

Met respect,
Team Mahber
`
    });

    res.json({
      message: "Registratie succesvol! Controleer uw e-mail.",
      memberId
    });

  } catch (err) {
    console.error("MAIL ERROR:", err);
    res.status(500).json({ message: "Serverfout bij verzending e-mail" });
  }
});

// ✅ Render juiste poort
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Mahber API draait op poort " + PORT);
});
