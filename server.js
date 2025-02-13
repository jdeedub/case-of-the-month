const session = require('express-session');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.set('view engine', 'ejs');

const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'mySecretKey',
  resave: false,
  saveUninitialized: false
}));

const db = new sqlite3.Database('quiz.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, 
    copr_section TEXT, 
    name TEXT, 
    email TEXT, 
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY,
    guess TEXT,
    isCorrect BOOLEAN,
    copr_section TEXT,
    name TEXT,
    score INTEGER DEFAULT 0,
    suggestion TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// NEW: Table for storing user suggestions
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    suggestion TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/views/login.html');
});

app.post('/login', (req, res) => {
  const { copr_section, name, email, security_answer } = req.body;

  const correctSecurityAnswer = "Lee";  
  if (security_answer.trim().toLowerCase() !== correctSecurityAnswer.toLowerCase()) {
    return res.send('<h2>Incorrect answer to the security question. Please try again.</h2>');
  }

  db.run("INSERT INTO users (copr_section, name, email) VALUES (?, ?, ?)", [copr_section, name, email], function (err) {
    if (err) {
      console.log(err.message);
      return res.send("Error saving user details.");
    }
    
    req.session.user = {
      id: this.lastID,
      copr_section,
      name,
      email
    };

    res.redirect('/quiz');
  });
});

app.get('/quiz', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  req.session.quizStartTime = Date.now();
  res.sendFile(__dirname + '/views/quiz.html');
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.send("Error logging out.");
    }
    res.redirect('/login');
  });
});

app.post('/submit', (req, res) => {
  if (!req.session.quizStartTime) {
    return res.send("Error: Quiz start time is missing. Please restart the quiz.");
  }

  const quizStartTime = req.session.quizStartTime;
  const now = Date.now();
  const timeElapsed = (now - quizStartTime) / 1000;

  if (timeElapsed > 180) {
    return res.send("Time's up! You took too long to answer.");
  }

  const userGuess = req.body.guess.trim().toLowerCase();
  const correctAnswers = ["cat", "kitty", "feline"]; 
  const isCorrect = correctAnswers.includes(userGuess); 

  const user = req.session.user;
  const copr_section = user ? user.copr_section : 'unknown';
  const name = user ? user.name : 'unknown';

  let score = isCorrect ? 5 : 0;

  const bonusSections = ["Peds", "IR", "MSK", "Emergency"];
  if (isCorrect && bonusSections.includes(copr_section)) {
    score = 6;
  }

  const explanation = "Cats are small, carnivorous mammals that have been domesticated for thousands of years. They are known for their agility, independence, and playful behavior.";

  db.run("INSERT INTO responses (guess, isCorrect, copr_section, name, score) VALUES (?, ?, ?, ?, ?)",
    [userGuess, isCorrect, copr_section, name, score],
    function (err) {
      if (err) {
        console.log(err.message);
        return res.send("There was an error saving your response.");
      }

      res.render('results', {
        result: isCorrect,  
        userGuess: req.body.guess,  
        correctAnswer: correctAnswers.join(", "), 
        explanation: explanation  
      });
  });
});

// NEW: Route to handle user suggestions
app.post('/submit-suggestion', (req, res) => {
  const suggestionText = req.body.suggestion;
  const user = req.session.user;

  if (!user) {
    return res.send("Error: User session not found.");
  }

  db.run("INSERT INTO suggestions (user_id, suggestion) VALUES (?, ?)", 
    [user.id, suggestionText], 
    function (err) {
      if (err) {
        console.log(err.message);
        return res.send("There was an error saving your suggestion.");
      }
      res.send("<h2>Thank you for your suggestion! It has been recorded.</h2><br><a href='/leaderboard'>Go to Leaderboard</a>");
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
