// Start-Fragen. Beim ersten Start werden sie in data/questions.json übernommen.
// Danach werden die Fragen im Admin-Bereich der Seite bearbeitet.
// Optional kann jede Frage ein Bild haben: image: "/uploads/....jpg" (wird im Admin-Bereich hochgeladen).
// Optional: duration (Sekunden) und points ("standard", "double" oder "none").
module.exports = [
  {
    text: "Was sind Fremdwörter?",
    options: ["Ein Wort aus einer anderen Sprache, das noch fremd klingt/geschrieben wird.", "Ein Wort das man nicht kennt.", "Ein Wort, das man nicht aussprechen kann."],
    correctIndices: [0]
  },
  {
    text: "Warum benutzen wir Fremdwörter?",
    options: ["Weil sie cooler klingen.", "Weil neue Erfindungen und Dinge einen Namen brauchen.", "Weil wir uns damit schlauer fühlen.", "Weil wir sie mögen."],
    correctIndices: [1]
  },
  {
    text: "Woran erkennt man Fremdwörter?",
    options: ["Man kann sie an ungewöhnlichen Schreibweisen erkennen.", "Man erkennt sie an ihrer Aura.", "Man erkennt sie am scharfen ß.", "Man erkennt sie am Nomen in ihrem Satz."],
    correctIndices: [0]
  },
  {
    text: "Entscheide: Was stimmt? (Es ist nur 1 richtig)",
    options: ["Diskutieren = Man hält eine Rede", "Kommunizieren = sich verständigen", "Organisieren = Etwas mit Freunden in der Stadt unternehmen"],
    correctIndices: [1]
  },
  {
    text: "Was bedeutet das Fremdwort 'Toleranz'?",
    options: ["= Ungeduld", "= Gleichgültigkeit", "= Duldsamkeit", "= Überheblichkeit"],
    correctIndices: [2]
  },
  {
    text: "Welche Buchstabenkombination kommt oft in Fremdwörtern vor?",
    options: ["-ter", "-mal", "-tion", "-schen"],
    correctIndices: [2]
  },
  {
    text: "Fremdwörter werden oft aus einer anderen Sprache an die deutsche Sprache angepasst. Aus welcher Sprache wurde das (deutsche) Keks abgeleitet?",
    options: ["Französisch", "Englisch", "Italienisch", "Türkisch"],
    correctIndices: [1]
  },
  {
    text: "Vielen Dank für die Teilnahme an diesem Quiz! Ich hoffe, es hat dir gefallen und du hast etwas Neues gelernt. Wenn du Fragen hast, wende dich gerne an mich. Ich wünsche dir noch einen schönen Tag!",
    options: ["Klicke auf den Button, um das Quiz zu beenden."],
    correctIndices: [0],
    points: "none"
  }
];
