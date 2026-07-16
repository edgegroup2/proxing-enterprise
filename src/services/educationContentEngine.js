'use strict';

const crypto = require('crypto');
const db = require('../db');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprintQuestion(stem, options = []) {
  const optionText = Array.isArray(options)
    ? options.map(o => normalizeText(o.text || o.label || o)).join('|')
    : '';

  return crypto
    .createHash('sha256')
    .update(`${normalizeText(stem)}|${optionText}`)
    .digest('hex');
}

function difficultyForIndex(index) {
  if (index % 5 === 0) return 3;
  if (index % 3 === 0) return 2;
  return 1;
}

function scoreDraftQuality({ stem, options = [], correctIndex, explanation }) {
  const hasStem = normalizeText(stem).length >= 10;
  const hasOptions = Array.isArray(options) && options.length >= 4;
  const hasCorrect = Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < options.length;
  const hasExplanation = normalizeText(explanation).length >= 10;

  let score = 0;
  if (hasStem) score += 0.35;
  if (hasOptions) score += 0.35;
  if (hasCorrect) score += 0.2;
  if (hasExplanation) score += 0.1;

  return {
    overall: Math.min(1, score),
    reason: hasStem && hasOptions && hasCorrect
      ? 'Seed question passed backend structural quality checks.'
      : 'Question needs clearer stem or complete options.'
  };
}

const QUESTION_BANK = {
  jamb: {
    Mathematics: [
      ['If 2x + 5 = 17, find x.', ['4', '5', '6', '7'], 2, '2x + 5 = 17, so 2x = 12 and x = 6.'],
      ['Simplify: 3a + 2a - a.', ['2a', '3a', '4a', '5a'], 2, '3a + 2a - a = 4a.'],
      ['Find the value of 5².', ['10', '15', '20', '25'], 3, '5 squared means 5 × 5 = 25.'],
      ['What is the next prime number after 7?', ['8', '9', '10', '11'], 3, '11 is the next prime after 7.'],
      ['Find 20% of 150.', ['20', '25', '30', '35'], 2, '20% of 150 is 0.2 × 150 = 30.']
    ],
    Physics: [
      ['The SI unit of force is?', ['Joule', 'Newton', 'Watt', 'Pascal'], 1, 'Force is measured in Newtons.'],
      ['Speed is defined as?', ['Distance/time', 'Time/distance', 'Mass/volume', 'Force/area'], 0, 'Speed equals distance divided by time.'],
      ['Which instrument measures electric current?', ['Voltmeter', 'Ammeter', 'Barometer', 'Thermometer'], 1, 'An ammeter measures current.'],
      ['The acceleration due to gravity is approximately?', ['5 m/s²', '9.8 m/s²', '20 m/s²', '100 m/s²'], 1, 'Near Earth, g is approximately 9.8 m/s².'],
      ['Light travels fastest in?', ['Water', 'Glass', 'Air', 'Vacuum'], 3, 'Light travels fastest in vacuum.']
    ],
    Biology: [
      ['The basic unit of life is the?', ['Tissue', 'Organ', 'Cell', 'System'], 2, 'The cell is the basic unit of life.'],
      ['Photosynthesis occurs mainly in the?', ['Root', 'Stem', 'Leaf', 'Flower'], 2, 'Leaves contain chlorophyll for photosynthesis.'],
      ['Which organ pumps blood?', ['Lung', 'Heart', 'Kidney', 'Liver'], 1, 'The heart pumps blood around the body.'],
      ['DNA is found mainly in the?', ['Nucleus', 'Cell wall', 'Vacuole', 'Ribosome'], 0, 'DNA is mainly located in the nucleus.'],
      ['The green pigment in plants is?', ['Melanin', 'Chlorophyll', 'Haemoglobin', 'Keratin'], 1, 'Chlorophyll gives plants their green colour.']
    ],
    Chemistry: [
      ['The chemical symbol for water is?', ['CO2', 'H2O', 'O2', 'NaCl'], 1, 'Water is H2O.'],
      ['An atom consists of protons, neutrons and?', ['Molecules', 'Electrons', 'Compounds', 'Ions'], 1, 'Atoms contain electrons around the nucleus.'],
      ['The pH of a neutral solution is?', ['1', '5', '7', '14'], 2, 'Neutral solutions have pH 7.'],
      ['NaCl is commonly called?', ['Sugar', 'Salt', 'Lime', 'Alcohol'], 1, 'NaCl is common salt.'],
      ['Acids turn blue litmus paper?', ['Blue', 'Red', 'Green', 'White'], 1, 'Acids turn blue litmus red.']
    ],
Economics: [
  ['According to the law of demand, when price rises, quantity demanded usually?', ['Increases', 'Falls', 'Stays constant', 'Doubles'], 1, 'Demand usually falls when price rises.'],
  ['Which factor of production earns rent as its reward?', ['Labour', 'Land', 'Capital', 'Entrepreneur'], 1, 'Land earns rent.'],
  ['The price of a commodity rises and other factors remain constant. What happens to quantity demanded?', ['It rises', 'It falls', 'It becomes zero', 'It is unchanged'], 1, 'Quantity demanded falls when price rises.']
],

Government: [
  ['A constitution is best described as', ['A political party', 'A set of fundamental laws', 'A court judgement', 'An election result'], 1, 'A constitution contains the fundamental laws of a state.'],
  ['Democracy means government by', ['One person', 'The people', 'The army', 'The courts'], 1, 'Democracy is government by the people.'],
  ['Citizenship refers to', ['Membership of a state', 'Payment of tax only', 'Joining a party', 'Owning property'], 0, 'Citizenship is legal membership of a state.']
],

'Literature in English': [
  ['Drama is mainly written to be', ['Performed', 'Counted', 'Measured', 'Ignored'], 0, 'Drama is written for performance.'],
  ['A poem is usually arranged in', ['Stanzas', 'Chapters', 'Acts', 'Scenes'], 0, 'Poems are commonly arranged in stanzas.'],
  ['Prose is written in', ['Ordinary sentences', 'Only rhymes', 'Musical notes', 'Stage directions'], 0, 'Prose uses ordinary sentence form.']
],
    'English Language': [
      ['Choose the correct synonym of “rapid”.', ['Slow', 'Fast', 'Weak', 'Late'], 1, 'Rapid means fast.'],
      ['Choose the antonym of “ancient”.', ['Old', 'Modern', 'Past', 'Former'], 1, 'Ancient means very old; its opposite is modern.'],
      ['Identify the noun: “The boy runs fast.”', ['boy', 'runs', 'fast', 'the'], 0, 'Boy is a noun.'],
      ['Choose the correct spelling.', ['Recieve', 'Receive', 'Receeve', 'Receve'], 1, 'Receive is the correct spelling.'],
      ['A group of words with a subject and predicate is a?', ['Phrase', 'Clause', 'Letter', 'Sound'], 1, 'A clause has a subject and predicate.']
    ]
  },

  waec: {},
  neco: {},
  ielts: {
    'IELTS Reading': [
      ['In IELTS Reading, “True” means the statement?', ['Agrees with the passage', 'Contradicts the passage', 'Is not mentioned', 'Is opinion only'], 0, 'True means the statement agrees with the passage.'],
      ['“Not Given” means?', ['False', 'The passage gives no clear information', 'Always true', 'A heading'], 1, 'Not Given means the information is not stated clearly.'],
      ['Skimming is used to get?', ['Exact spelling', 'General idea', 'Grammar rules', 'Pronunciation'], 1, 'Skimming helps you understand the general idea quickly.']
    ],
    'IELTS Writing': [
      ['Task 2 is usually a/an?', ['Essay', 'Map only', 'Listening task', 'Speaking test'], 0, 'IELTS Writing Task 2 is an essay.'],
      ['A strong essay should have?', ['No paragraphs', 'Clear introduction and conclusion', 'Only examples', 'No opinion'], 1, 'A good essay has structure.'],
      ['Coherence means?', ['Clear logical flow', 'Long words only', 'Correct spelling only', 'Short answers'], 0, 'Coherence is logical flow.']
    ],
    'IELTS Listening': [
      ['IELTS Listening answers are taken from?', ['The audio', 'The examiner', 'The dictionary', 'The reading passage'], 0, 'Listening answers come from the audio.'],
      ['Before listening, candidates should?', ['Ignore questions', 'Predict answer type', 'Close the booklet', 'Write randomly'], 1, 'Predicting answer type helps accuracy.']
    ],
    'IELTS Speaking': [
      ['IELTS Speaking Part 2 is commonly called?', ['Cue card', 'Essay', 'Dictation', 'Summary'], 0, 'Part 2 uses a cue card.'],
      ['Fluency means speaking?', ['Clearly and continuously', 'Very quietly', 'Only one word', 'Without grammar'], 0, 'Fluency means smooth continuous speech.']
    ]
  },

  gre: {
    'GRE Quantitative Reasoning': [
      ['If x + 3 = 10, x equals?', ['5', '6', '7', '8'], 2, 'x = 10 - 3 = 7.'],
      ['The median of 2, 4, 8 is?', ['2', '4', '8', '14'], 1, 'The middle value is 4.'],
      ['If a number is doubled from 6, the result is?', ['8', '10', '12', '14'], 2, 'Double of 6 is 12.']
    ],
    'GRE Verbal': [
      ['Choose the closest meaning of “ambiguous”.', ['Clear', 'Uncertain', 'Fast', 'Ancient'], 1, 'Ambiguous means unclear or uncertain.'],
      ['Choose the antonym of “scarce”.', ['Rare', 'Abundant', 'Limited', 'Few'], 1, 'Scarce means limited; abundant is opposite.']
    ],
    'GRE Analytical Writing': [
      ['GRE Analytical Writing mainly tests?', ['Typing speed', 'Critical reasoning and writing', 'Listening', 'Spelling only'], 1, 'It tests reasoning and written argument.']
    ]
  },

  sat: {
    'SAT Math': [
      ['If 3x = 12, x equals?', ['2', '3', '4', '5'], 2, 'Divide both sides by 3.'],
      ['What is 15% of 200?', ['15', '20', '25', '30'], 3, '0.15 × 200 = 30.'],
      ['The slope of y = 2x + 1 is?', ['1', '2', '3', '4'], 1, 'In y = mx + b, m is slope.']
    ],
    'SAT Reading and Writing': [
      ['A claim is best described as?', ['Evidence', 'Main argument', 'Punctuation', 'Transition'], 1, 'A claim is the main argument.'],
      ['Choose the best transition for contrast.', ['Therefore', 'However', 'Also', 'Because'], 1, 'However introduces contrast.']
    ]
  }
};

QUESTION_BANK.waec = {
  Mathematics: [
    ['In WAEC Mathematics, what is 25% of 200?', ['25', '40', '50', '75'], 2, '25% of 200 = 50.'],
    ['Solve: 3x + 6 = 18.', ['2', '3', '4', '6'], 2, '3x = 12, so x = 4.'],
    ['The angles in a triangle add up to?', ['90°', '180°', '270°', '360°'], 1, 'Angles in a triangle sum to 180°.'],
    ['Simplify: 2a + 3a.', ['5a', '6a', 'a', '5'], 0, 'Like terms are added: 2a + 3a = 5a.'],
    ['Find the square root of 144.', ['10', '11', '12', '14'], 2, '12 × 12 = 144.']
  ],

  'English Language': [
    ['Choose the correct spelling.', ['Recieve', 'Receive', 'Receeve', 'Receve'], 1, 'Receive is the correct spelling.'],
    ['Identify the noun: “The boy kicked the ball.”', ['boy', 'kicked', 'the', 'ball kicked'], 0, 'Boy is a noun.'],
    ['Choose the antonym of “ancient”.', ['Old', 'Modern', 'Past', 'Former'], 1, 'Modern is the opposite of ancient.'],
    ['A group of words with subject and predicate is a?', ['Phrase', 'Clause', 'Letter', 'Sound'], 1, 'A clause has a subject and predicate.'],
    ['Choose the correct synonym of “rapid”.', ['Slow', 'Fast', 'Weak', 'Late'], 1, 'Rapid means fast.']
  ],

  Biology: [
    ['The basic unit of life is the?', ['Tissue', 'Organ', 'Cell', 'System'], 2, 'The cell is the basic unit of life.'],
    ['Photosynthesis mainly occurs in the?', ['Root', 'Stem', 'Leaf', 'Flower'], 2, 'Leaves contain chlorophyll for photosynthesis.'],
    ['Which organ pumps blood?', ['Lung', 'Heart', 'Kidney', 'Liver'], 1, 'The heart pumps blood.'],
    ['DNA is mainly found in the?', ['Nucleus', 'Cell wall', 'Vacuole', 'Ribosome'], 0, 'DNA is mainly located in the nucleus.'],
    ['The green pigment in plants is?', ['Melanin', 'Chlorophyll', 'Haemoglobin', 'Keratin'], 1, 'Chlorophyll gives plants their green colour.']
  ],

  Chemistry: [
    ['The chemical symbol for water is?', ['CO2', 'H2O', 'O2', 'NaCl'], 1, 'Water is H2O.'],
    ['An atom consists of protons, neutrons and?', ['Molecules', 'Electrons', 'Compounds', 'Ions'], 1, 'Atoms contain electrons around the nucleus.'],
    ['The pH of a neutral solution is?', ['1', '5', '7', '14'], 2, 'Neutral solutions have pH 7.'],
    ['NaCl is commonly called?', ['Sugar', 'Salt', 'Lime', 'Alcohol'], 1, 'NaCl is common salt.'],
    ['Acids turn blue litmus paper?', ['Blue', 'Red', 'Green', 'White'], 1, 'Acids turn blue litmus red.']
  ],

  Physics: [
    ['The SI unit of force is?', ['Joule', 'Newton', 'Watt', 'Pascal'], 1, 'Force is measured in Newtons.'],
    ['Speed is defined as?', ['Distance/time', 'Time/distance', 'Mass/volume', 'Force/area'], 0, 'Speed equals distance divided by time.'],
    ['Which instrument measures electric current?', ['Voltmeter', 'Ammeter', 'Barometer', 'Thermometer'], 1, 'An ammeter measures current.'],
    ['Acceleration due to gravity is approximately?', ['5 m/s²', '9.8 m/s²', '20 m/s²', '100 m/s²'], 1, 'Near Earth, g is approximately 9.8 m/s².'],
    ['Light travels fastest in?', ['Water', 'Glass', 'Air', 'Vacuum'], 3, 'Light travels fastest in vacuum.']
  ],

  Economics: [
    ['In WAEC Economics, demand refers to?', ['Desire backed by ability to pay', 'Only desire', 'Only money', 'Production'], 0, 'Demand is desire backed by ability and willingness to pay.'],
    ['Which factor can cause inflation?', ['Too much money chasing few goods', 'Lower prices', 'More supply only', 'No spending'], 0, 'Inflation can occur when money supply rises faster than goods available.'],
    ['A market is best described as?', ['A place or system for buying and selling', 'Only a shop', 'Only a bank', 'Only a factory'], 0, 'A market is any arrangement where buyers and sellers exchange goods or services.'],
    ['Opportunity cost means?', ['The next best alternative forgone', 'Total money spent', 'Profit only', 'Government tax'], 0, 'Opportunity cost is the alternative sacrificed when a choice is made.'],
    ['The basic economic problem is?', ['Scarcity', 'Luxury', 'Advertising', 'Transport'], 0, 'Scarcity means resources are limited compared with wants.']
  ],

  Government: [
    ['A constitution is best described as?', ['A political party', 'A set of fundamental laws', 'A court judgement', 'An election result'], 1, 'A constitution contains the fundamental laws of a state.'],
    ['Democracy means government by?', ['One person', 'The people', 'The army', 'The courts'], 1, 'Democracy is government by the people.'],
    ['Citizenship refers to?', ['Membership of a state', 'Payment of tax only', 'Joining a party', 'Owning property'], 0, 'Citizenship is legal membership of a state.'],
    ['The legislature mainly performs which function?', ['Making laws', 'Interpreting laws', 'Enforcing laws', 'Printing money'], 0, 'The legislature makes laws.'],
    ['Rule of law means?', ['Supremacy of law', 'Rule by soldiers', 'Rule by rich people', 'No courts'], 0, 'Rule of law means everyone is subject to the law.']
  ],

  'Literature in English': [
    ['Drama is mainly written to be?', ['Performed', 'Counted', 'Measured', 'Ignored'], 0, 'Drama is written for performance.'],
    ['A poem is usually arranged in?', ['Stanzas', 'Chapters', 'Acts', 'Scenes'], 0, 'Poems are commonly arranged in stanzas.'],
    ['Prose is written in?', ['Ordinary sentences', 'Only rhymes', 'Musical notes', 'Stage directions'], 0, 'Prose uses ordinary sentence form.'],
    ['A character in literature is?', ['A person or figure in a story', 'A punctuation mark', 'A textbook cover', 'A topic sentence'], 0, 'Characters are people or figures in literary works.'],
    ['Theme means?', ['Central idea', 'Book size', 'Author name only', 'Page number'], 0, 'Theme is the central idea of a literary work.']
  ]
};

QUESTION_BANK.neco = {
  Mathematics: [
    ['In NECO Mathematics, simplify 4x + 2x.', ['2x', '4x', '6x', '8x'], 2, '4x + 2x = 6x.'],
    ['Find 10% of 500.', ['5', '25', '50', '100'], 2, '10% of 500 = 50.'],
    ['Solve: x - 7 = 12.', ['5', '12', '19', '21'], 2, 'x = 12 + 7 = 19.'],
    ['What is the value of 9²?', ['18', '27', '81', '90'], 2, '9² = 81.'],
    ['A rectangle area is calculated by?', ['Length × breadth', 'Length + breadth', '2 × length', 'Breadth only'], 0, 'Area of rectangle = length × breadth.']
  ],

  'English Language': [
    ['Choose the correct plural of “child”.', ['Childs', 'Children', 'Childes', 'Childrens'], 1, 'Children is the correct plural.'],
    ['Choose the correct tense: “She ____ to school daily.”', ['go', 'goes', 'gone', 'going'], 1, 'She goes is correct.'],
    ['A word opposite in meaning is called?', ['Synonym', 'Antonym', 'Pronoun', 'Verb'], 1, 'An antonym is an opposite word.'],
    ['Choose the synonym of “happy”.', ['Sad', 'Joyful', 'Angry', 'Tired'], 1, 'Happy means joyful.'],
    ['Identify the verb: “They played football.”', ['They', 'played', 'football', 'the'], 1, 'Played is the action word.']
  ],

  Biology: [
    ['The study of living things is?', ['Biology', 'Physics', 'Chemistry', 'Economics'], 0, 'Biology is the study of living things.'],
    ['The organ for breathing in humans is?', ['Heart', 'Lung', 'Kidney', 'Stomach'], 1, 'Lungs are used for breathing.'],
    ['Plants make food through?', ['Respiration', 'Photosynthesis', 'Digestion', 'Excretion'], 1, 'Plants make food by photosynthesis.'],
    ['Blood is pumped by the?', ['Brain', 'Heart', 'Liver', 'Skin'], 1, 'The heart pumps blood.'],
    ['The habitat of a fish is usually?', ['Desert', 'Water', 'Air', 'Tree'], 1, 'Fish live in water.']
  ],

  Chemistry: [
    ['NECO Chemistry studies mainly?', ['Matter and its changes', 'Only animals', 'Only numbers', 'Government'], 0, 'Chemistry studies matter and its changes.'],
    ['Oxygen supports?', ['Burning', 'Freezing only', 'Rust prevention only', 'Darkness'], 0, 'Oxygen supports combustion.'],
    ['Common salt has the formula?', ['H2O', 'CO2', 'NaCl', 'O2'], 2, 'Common salt is sodium chloride, NaCl.'],
    ['A base turns red litmus?', ['Blue', 'Red', 'Green', 'Black'], 0, 'Bases turn red litmus blue.'],
    ['The smallest particle of an element is?', ['Atom', 'Compound', 'Mixture', 'Solution'], 0, 'An atom is the smallest particle of an element.']
  ],

  Physics: [
    ['NECO Physics deals with?', ['Matter, energy and forces', 'Only poems', 'Only taxes', 'Only grammar'], 0, 'Physics studies matter, energy and forces.'],
    ['The unit of electric current is?', ['Volt', 'Ampere', 'Newton', 'Joule'], 1, 'Electric current is measured in amperes.'],
    ['Heat is a form of?', ['Energy', 'Mass', 'Volume', 'Colour'], 0, 'Heat is a form of energy.'],
    ['A machine makes work?', ['Easier', 'Harder only', 'Impossible', 'Slower only'], 0, 'Machines help make work easier.'],
    ['Sound travels fastest in?', ['Solids', 'Vacuum', 'Air only', 'Water only'], 0, 'Sound travels fastest in solids.']
  ],

  Economics: [
    ['Economics is the study of?', ['Scarce resources', 'Only money', 'Politics', 'History'], 0, 'Economics studies how scarce resources are allocated.'],
    ['Demand curve normally slopes?', ['Downward', 'Upward', 'Vertical', 'Horizontal'], 0, 'Demand generally slopes downward.'],
    ['Inflation means?', ['General rise in prices', 'Fall in prices', 'No prices', 'Fixed prices'], 0, 'Inflation is a persistent increase in the general price level.'],
    ['A producer aims to?', ['Make profit', 'Pay tax only', 'Buy goods only', 'Vote'], 0, 'Businesses generally seek profit.'],
    ['The reward for labour is?', ['Wages', 'Rent', 'Interest', 'Profit'], 0, 'Labour earns wages.']
  ],

  Government: [
    ['The executive arm mainly?', ['Implements laws', 'Makes laws', 'Interprets laws', 'Conducts exams'], 0, 'The executive implements laws and policies.'],
    ['Nigeria practices?', ['Democracy', 'Monarchy', 'Dictatorship', 'Theocracy'], 0, 'Nigeria operates a democratic system.'],
    ['Voting age in Nigeria is?', ['18 years', '16 years', '21 years', '25 years'], 0, 'Citizens can vote from age 18.'],
    ['The judiciary is responsible for?', ['Interpreting laws', 'Making laws', 'Collecting tax', 'Conducting census'], 0, 'The judiciary interprets laws.'],
    ['A political party seeks to?', ['Win political power', 'Run schools', 'Sell products', 'Collect customs duty'], 0, 'Political parties seek governmental power through elections.']
  ],

  'Literature in English': [
    ['A novel is a type of?', ['Prose', 'Drama', 'Poetry only', 'Music'], 0, 'A novel is a prose narrative.'],
    ['Poetry commonly uses?', ['Imagery', 'Taxes', 'Constitutions', 'Budgets'], 0, 'Imagery is a major poetic device.'],
    ['The person who writes a book is?', ['Author', 'Actor', 'Reader', 'Editor only'], 0, 'The author creates the literary work.'],
    ['Drama is divided into?', ['Acts and scenes', 'Paragraphs only', 'Pages only', 'Budgets'], 0, 'Dramatic works are organised into acts and scenes.'],
    ['The setting of a story means?', ['Time and place', 'Author name', 'Book cover', 'Theme only'], 0, 'Setting refers to where and when a story occurs.']
  ]
};

async function ensureQuestionDraftSchema() {
  await db.query(`
    ALTER TABLE question_drafts
    ADD COLUMN IF NOT EXISTS fingerprint text,
    ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS generation_batch_id uuid,
    ADD COLUMN IF NOT EXISTS source_engine text DEFAULT 'backend',
    ADD COLUMN IF NOT EXISTS publish_status text DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS quality_score numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS overall_quality_score numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duplicate_risk numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quality_reason text,
    ADD COLUMN IF NOT EXISTS quality_scored_at timestamptz
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_question_drafts_fingerprint
    ON question_drafts(fingerprint)
  `);
}

async function ensurePublishQueueSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS question_publish_queue (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      draft_id uuid NOT NULL REFERENCES question_drafts(id) ON DELETE CASCADE,
      priority int NOT NULL DEFAULT 5,
      status text NOT NULL DEFAULT 'pending',
      error_text text,
      last_error text,
      retry_count int NOT NULL DEFAULT 0,
      last_attempt_at timestamptz,
      scheduled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      processed_at timestamptz
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_question_publish_queue_status
    ON question_publish_queue(status)
  `);
}

async function ensureOptionTableSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS question_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      option_text text NOT NULL,
      is_correct boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getOrCreateTopic(subjectId, topicName, difficulty = 1) {
  const existing = await db.query(
    `SELECT id FROM topics WHERE subject_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [subjectId, topicName]
  );

  if (existing.rows.length) return existing.rows[0].id;

const created = await db.query(`
  INSERT INTO topics (subject_id, name, difficulty, status, created_at)
  VALUES ($1, $2, $3, 'active', now())
  ON CONFLICT DO NOTHING
  RETURNING id
`, [subjectId, topicName, difficulty]);

if (created.rows.length) return created.rows[0].id;

const fallback = await db.query(
  `SELECT id FROM topics WHERE subject_id = $1 AND lower(name) = lower($2) LIMIT 1`,
  [subjectId, topicName]
);

return fallback.rows[0]?.id || null;
}

async function scoreDraft({ stem, options, explanation }) {
  const hasStem = normalizeText(stem).length >= 10;
  const hasOptions = Array.isArray(options) && options.length >= 4;
  const hasExplanation = normalizeText(explanation).length >= 10;

  let score = 0;
  if (hasStem) score += 0.35;
  if (hasOptions) score += 0.35;
  if (hasExplanation) score += 0.2;
  score += 0.1;

  return {
    overall: Math.min(1, score),
    reason: hasStem && hasOptions
      ? 'Seed question passed backend structural quality checks.'
      : 'Question needs clearer stem or complete options.'
  };
}

async function draftExists(fingerprint) {
  const draft = await db.query(
    `SELECT id FROM question_drafts WHERE fingerprint = $1 LIMIT 1`,
    [fingerprint]
  );

  if (draft.rows.length) return true;

  const existingQuestion = await db.query(
    `SELECT id FROM questions WHERE fingerprint = $1 LIMIT 1`,
    [fingerprint]
  ).catch(() => ({ rows: [] }));

  return existingQuestion.rows.length > 0;
}

async function createDraft({
  examType,
  subjectId,
  topicId,
  stem,
  options,
  correctIndex,
  explanation,
  difficulty,
  year = null,
  sourceReference = 'backend-seed'
}) {
  await ensureQuestionDraftSchema();

  const fp = fingerprintQuestion(stem, options);

  if (await draftExists(fp)) {
    return { skipped: true, reason: 'duplicate', fingerprint: fp };
  }

const quality = scoreDraftQuality({ stem, options, correctIndex, explanation });
const reviewStatus = quality.overall >= 0.70 ? 'approved' : 'needs_edit';
const publishStatus = reviewStatus === 'approved' ? 'pending' : 'draft';

const result = await db.query(
  `
  INSERT INTO question_drafts (
    exam_type,
    subject_id,
    topic_id,
    question_text,
    explanation,
    difficulty,
    year,
    options,
    correct_answer,
    correct_option_index,
    source_reference,
    fingerprint,
    review_status,
    publish_status,
    quality_score,
    quality_reason
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16
  )
  RETURNING *
  `,
  [
    examType,
    subjectId,
    topicId,
    stem,
    explanation,
    difficulty,
    year,
    JSON.stringify(options.map((text, idx) => ({
      id: String.fromCharCode(65 + idx),
      text,
      is_correct: idx === correctIndex
    }))),
    options[correctIndex],
    correctIndex,
    sourceReference,
    fp,
    reviewStatus,
    publishStatus,
    quality.overall,
    quality.reason
  ]
);

  return { skipped: false, draft: result.rows[0] };
}

async function seedDraftsForAllExams({ autoQueue = true } = {}) {
  await ensureQuestionDraftSchema();
  await ensurePublishQueueSchema();

  const subjects = await db.query(`
    SELECT id, name, exam_type
    FROM subjects
    ORDER BY exam_type, name
  `);

  const summary = {
    created: 0,
    skipped: 0,
    queued: 0,
    missingSubjects: []
  };

  for (const subject of subjects.rows) {
    const examType = String(subject.exam_type || '').toLowerCase();
    const bankByExam = QUESTION_BANK[examType] || {};
    const questions = bankByExam[subject.name];

    if (!questions || !questions.length) {
      summary.missingSubjects.push(`${examType}:${subject.name}`);
      continue;
    }

    let index = 0;

    for (const [stem, options, correctIndex, explanation] of questions) {
      index += 1;

      const topicName = subject.name.includes('IELTS')
        ? subject.name
        : index <= 2
          ? 'Foundations'
          : index <= 4
            ? 'Core Concepts'
            : 'Exam Practice';

      const topicId = await getOrCreateTopic(subject.id, topicName, difficultyForIndex(index));

      const created = await createDraft({
        examType,
        subjectId: subject.id,
        topicId,
        stem,
        options,
        correctIndex,
        explanation,
        difficulty: difficultyForIndex(index)
      });

      if (created.skipped) {
        summary.skipped += 1;
        continue;
      }

      summary.created += 1;

      if (autoQueue && created.draft.review_status === 'approved') {
        await db.query(
          `
          INSERT INTO question_publish_queue (draft_id, priority, status, created_at)
VALUES ($1, 5, 'pending', now())
          ON CONFLICT DO NOTHING
          `,
          [created.draft.id]
        );
        summary.queued += 1;
      }
    }
  }

  return summary;
}


async function publishQueuedQuestions({ limit = 50 } = {}) {
  await ensurePublishQueueSchema();
  await ensureOptionTableSchema();

  const client = await db.connect();

  const summary = {
    published: 0,
    failed: 0,
    errors: []
  };

  try {
    await client.query('BEGIN');

    const queue = await client.query(
      `
      SELECT
        qpq.id AS queue_id,
        qd.*
      FROM question_publish_queue qpq
      JOIN question_drafts qd ON qd.id = qpq.draft_id
      WHERE qpq.status IN ('pending', 'failed')
        AND qd.review_status = 'approved'
        AND qd.publish_status = 'pending'
        AND qd.topic_id IS NOT NULL
        AND qd.subject_id IS NOT NULL
      ORDER BY qpq.priority DESC, qpq.created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [limit]
    );

    for (const row of queue.rows) {
      await client.query('SAVEPOINT publish_one');

      try {
        if (!row.topic_id || !row.subject_id || !row.question_text) {
          throw new Error('Draft missing topic_id, subject_id, or question_text');
        }

const existing = await client.query(
  `SELECT id FROM questions
   WHERE topic_id = $1 AND stem = $2
   LIMIT 1`,
  [row.topic_id, row.question_text]
);

        if (existing.rows.length) {
          await client.query(
            `
            UPDATE question_publish_queue
            SET status = 'done',
                processed_at = now(),
                last_attempt_at = now()
            WHERE id = $1
            `,
            [row.queue_id]
          );

          await client.query(
            `
            UPDATE question_drafts
            SET publish_status = 'published',
                published_question_id = $2,
                updated_at = now()
            WHERE id = $1
            `,
            [row.id, existing.rows[0].id]
          );

          await client.query('RELEASE SAVEPOINT publish_one');
          summary.published += 1;
          continue;
        }

        const inserted = await client.query(
          `
             INSERT INTO questions (
             topic_id,
             subject_id,
             type,
             stem,
             explanation,
             difficulty,
             source,
             fingerprint,
             created_at
             )
             VALUES (
             $1,
             $2,
             'mcq',
             $3,
             $4,
             $5,
             'backend_seed',
             $6,
             now()
             )
             RETURNING id
          `,
          [
            row.topic_id,
            row.subject_id,
            row.question_text,
            row.explanation,
            row.difficulty || 1,
            row.fingerprint || row.source_hash
          ]
        );

        const questionId = inserted.rows[0].id;

        let options = row.options || [];
        if (typeof options === 'string') {
          try { options = JSON.parse(options); } catch { options = []; }
        }
        if (!Array.isArray(options)) options = [];

        for (const opt of options) {
          const optionText = opt.text || opt.label || String(opt);
          const isCorrect =
            Boolean(opt.is_correct) ||
            optionText === row.correct_answer ||
            opt.label === row.correct_answer;

          await client.query(
            `
           INSERT INTO question_options (question_id, label, text, is_correct, explanation)
          VALUES ($1, $2, $3, $4, $5)
            `,
[
  questionId,
  opt.label || String.fromCharCode(65 + options.indexOf(opt)),
  optionText,
  isCorrect,
  isCorrect ? row.explanation : null
]
          );
        }

        await client.query(
          `
          UPDATE question_drafts
          SET publish_status = 'published',
              published_question_id = $2,
              updated_at = now()
          WHERE id = $1
          `,
          [row.id, questionId]
        );

        await client.query(
          `
          UPDATE question_publish_queue
          SET status = 'done',
              processed_at = now(),
              last_attempt_at = now(),
              error = NULL,
              last_error = NULL
          WHERE id = $1
          `,
          [row.queue_id]
        );

        await client.query('RELEASE SAVEPOINT publish_one');
        summary.published += 1;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT publish_one');

        summary.failed += 1;
        summary.errors.push({
          draft_id: row.id,
          queue_id: row.queue_id,
          error: err.message
        });

        await client.query(
          `
          UPDATE question_publish_queue
          SET status = CASE
                WHEN COALESCE(retry_count, 0) + 1 >= 5 THEN 'dead'
                ELSE 'failed'
              END,
              error = $2,
              last_error = $2,
              retry_count = COALESCE(retry_count, 0) + 1,
              last_attempt_at = now()
          WHERE id = $1
          `,
          [row.queue_id, err.message]
        );

        await client.query('RELEASE SAVEPOINT publish_one');
      }
    }

    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  normalizeText,
  fingerprintQuestion,
  seedDraftsForAllExams,
  publishQueuedQuestions,
  createDraft
};
