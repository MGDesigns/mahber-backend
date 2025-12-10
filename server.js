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
