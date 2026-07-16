const fs = require('fs');
const path = require('path');

const topics = {
  "Demand and Supply": [
    {
      question: "According to the law of demand, when price rises, quantity demanded will usually...",
      options: [
        { label: "A", text: "increase", is_correct: false },
        { label: "B", text: "fall", is_correct: true },
        { label: "C", text: "remain constant", is_correct: false },
        { label: "D", text: "become zero", is_correct: false }
      ],
      explanation: "The law of demand states that quantity demanded falls as price rises, ceteris paribus."
    },
    {
      question: "A rightward shift in supply indicates...",
      options: [
        { label: "A", text: "decrease in supply", is_correct: false },
        { label: "B", text: "increase in supply", is_correct: true },
        { label: "C", text: "higher prices only", is_correct: false },
        { label: "D", text: "market failure", is_correct: false }
      ],
      explanation: "A rightward shift means more quantity supplied at each price."
    }
  ],

  "Opportunity Cost": [
    {
      question: "Opportunity cost refers to...",
      options: [
        { label: "A", text: "money spent only", is_correct: false },
        { label: "B", text: "next best alternative forgone", is_correct: true },
        { label: "C", text: "production cost", is_correct: false },
        { label: "D", text: "fixed cost", is_correct: false }
      ],
      explanation: "Opportunity cost is the value of the best alternative sacrificed."
    }
  ],

  "Elasticity": [
    {
      question: "Demand is elastic when...",
      options: [
        { label: "A", text: "PED > 1", is_correct: true },
        { label: "B", text: "PED < 1", is_correct: false },
        { label: "C", text: "PED = 0", is_correct: false },
        { label: "D", text: "PED = 1", is_correct: false }
      ],
      explanation: "Elastic demand means quantity responds more than proportionately."
    }
  ]
};

const rows = [];

for (const [topic, questions] of Object.entries(topics)) {
  for (const q of questions) {
    rows.push({
      exam_type: "jamb",
      subject: "Economics",
      topic,
      year: 2025,
      stem: q.question,
      explanation: q.explanation,
      difficulty: 2,
      source: "JAMB Premium Pack v1",
      options: q.options
    });
  }
}

const output = path.join(
  __dirname,
"../../data/past-questions/jamb-economics-premium-v1.json"
);

fs.writeFileSync(output, JSON.stringify(rows, null, 2));
console.log(`Generated ${rows.length} questions -> ${output}`);
