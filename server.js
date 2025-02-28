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

// Create necessary tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, 
    copr_section TEXT, 
    name TEXT, 
    email TEXT, 
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY,
    guess TEXT,
    isCorrect BOOLEAN,
    copr_section TEXT,
    name TEXT,
    score INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    suggestion TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Redirect root to login
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Serve the login page
app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/views/login.html');
});

// Handle login submission
app.post('/login', (req, res) => {
  const { copr_section, name, email, security_answer } = req.body;

  if (!copr_section) {
    return res.send('<h2>Please select a COPR section before proceeding.</h2>');
  }

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

// Serve the quiz page
app.get('/quiz', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  req.session.quizStartTime = Date.now();
  res.sendFile(__dirname + '/views/quiz.html');
});

// Handle logout
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.send("Error logging out.");
    }
    res.redirect('/login');
  });
});

// Handle quiz submission
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
  const correctAnswers = ["cvi", "velum interpositum", "cavum veli interpositi", "cavum velum interpositum cyst", "cavum velum interpositum"]; 
  const isCorrect = correctAnswers.includes(userGuess); 

  const user = req.session.user;
  if (!user) {
    return res.send("Error: User session not found.");
  }

  const copr_section = user.copr_section;
  const name = user.name;

  let score = isCorrect ? 5 : 0;
  const bonusSections = ["Peds", "IR", "MSK", "Emergency"];
  if (isCorrect && bonusSections.includes(copr_section)) {
    score = 6;
  }

  db.run("INSERT INTO responses (guess, isCorrect, copr_section, name, score) VALUES (?, ?, ?, ?, ?)",
    [userGuess, isCorrect, copr_section, name, score],
    function (err) {
      if (err) {
        console.log(err.message);
        return res.send("There was an error saving your response.");
      }

      res.render('results');  // Only show submission confirmation
  });
});

// Handle user suggestions
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

// Leaderboard route
app.get('/leaderboard', (req, res) => {
  const sectionSQL = `
    SELECT copr_section, SUM(score) as total_score
    FROM (
        SELECT copr_section, score
        FROM responses
        WHERE copr_section IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 5
    ) 
    GROUP BY copr_section
    ORDER BY total_score DESC;
  `;

  const individualSQL = `
    SELECT name, copr_section, COUNT(*) as correct_count
    FROM responses
    WHERE isCorrect = 1
    GROUP BY name, copr_section
    HAVING correct_count > 1
    ORDER BY correct_count DESC, name ASC
    LIMIT 5;
  `;

  db.all(sectionSQL, [], (err, sectionRows) => {
    if (err) {
      console.log(err.message);
      return res.send("Error retrieving section leaderboard data.");
    }

    db.all(individualSQL, [], (err, individualRows) => {
      if (err) {
        console.log(err.message);
        return res.send("Error retrieving individual performer data.");
      }

      res.render('leaderboard', {
        leaderboard: sectionRows,
        topPerformers: individualRows
      });
    });
  });
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log("Shutting down server gracefully...");
  process.exit();
});

process.on('SIGTERM', () => {
  console.log("Shutting down server gracefully...");
  process.exit();
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
