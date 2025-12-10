import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json());

let counter = 1000;

// Mail setup
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 587,
  secure: false,
  auth: {
    user: "info@mahber.be",
    pass: "AhYalanDunya25.15!"
  }
});

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

    const age = calculateAge(data.birth_date);
    if (age >= 65) {
      return res.status(400).json({ message: "Leeftijdsgrens overschreden" });
    }

    const year = new Date().getFullYear();
    const memberId = `M${counter++}-${year}`;

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
    console.error(err);
    res.status(500).json({ message: "Serverfout" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Mahber API draait op poort " + PORT));
