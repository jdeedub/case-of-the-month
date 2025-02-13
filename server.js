const session = require('express-session');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.set('view engine', 'ejs');  // Set the view engine AFTER creating the app

// Use the port provided by Heroku, or default to 3000 if not available.
const port = process.env.PORT || 3000;

// Middleware to serve static files like images
app.use(express.static('public'));

// Body parsing middleware to handle form submissions
app.use(express.urlencoded({ extended: true }));

// Session middleware configuration
app.use(session({
  secret: 'mySecretKey', 
  resave: false,
  saveUninitialized: false
}));

// Set up SQLite database
const db = new sqlite3.Database('quiz.db');

// Create tables if they don't exist
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

// Handle login form submission
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
    
    req.session.user = { id: this.lastID, copr_section, name, email };
    res.redirect('/quiz');
  });
});

// Serve the quiz page
app.get('/quiz', (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  req.session.quizStartTime = Date.now();
  res.sendFile(__dirname + '/views/quiz.html');
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.send("Error logging out.");
    res.redirect('/login');
  });
});

// **Route to handle quiz submissions**
app.post('/submit', (req, res) => {
  if (!req.session.quizStartTime) {
    return res.send("Error: Quiz start time is missing. Please restart the quiz.");
  }

  const quizStartTime = req.session.quizStartTime;
  const now = Date.now();
  const timeElapsed = (now - quizStartTime) / 1000;

  if (timeElapsed > 180) return res.send("Time's up! You took too long to answer.");

  const userGuess = req.body.guess.trim().toLowerCase();
  const correctAnswers = ["cat", "kitty", "feline"];
  const isCorrect = correctAnswers.includes(userGuess);

  const user = req.session.user;
  const copr_section = user ? user.copr_section : 'unknown';
  const name = user ? user.name : 'unknown';

  let score = isCorrect ? 5 : 0;
  const bonusSections = ["Peds", "IR", "MSK", "Emergency"];
  if (isCorrect && bonusSections.includes(copr_section)) score = 6;

  db.run("INSERT INTO responses (guess, isCorrect, copr_section, name, score) VALUES (?, ?, ?, ?, ?)",
    [userGuess, isCorrect, copr_section, name, score],
    function (err) {
      if (err) {
        console.log(err.message);
        return res.send("Error saving response.");
      }

      console.log(`Response saved with ID ${this.lastID}`);

      // **Show results page first!**
      res.render('results', {
        result: isCorrect,
        userGuess: req.body.guess,
        correctAnswer: correctAnswers.join(", "),
        explanation: "Cats are small, carnivorous mammals that have been domesticated for thousands of years.",
        responseId: this.lastID
      });
  });
});

// **Leaderboard Route**
app.get('/leaderboard', (req, res) => {
  db.all("SELECT copr_section, SUM(score) as total_score FROM responses GROUP BY copr_section ORDER BY total_score DESC", [], (err, sectionRows) => {
    if (err) return res.send("Error retrieving section leaderboard data.");

    db.all("SELECT name, copr_section, COUNT(*) as correct_count FROM responses WHERE isCorrect = 1 GROUP BY name, copr_section HAVING correct_count > 1 ORDER BY correct_count DESC, name ASC LIMIT 5;", [], (err, individualRows) => {
      if (err) return res.send("Error retrieving individual performer data.");

      res.render('leaderboard', { leaderboard: sectionRows, topPerformers: individualRows });
    });
  });
});

// **Handle Suggestions**
app.post('/suggest', (req, res) => {
  db.run("UPDATE responses SET suggestion = ? WHERE id = ?", [req.body.suggestion, req.body.responseId], function(err) {
    if (err) return res.send("Error saving suggestion.");
    res.send("Thank you for your suggestion!");
  });
});

// **Graceful Shutdown**
process.on('SIGINT', () => { console.log("Shutting down server..."); process.exit(); });
process.on('SIGTERM', () => { console.log("Shutting down server..."); process.exit(); });

// **Start the Server**
app.listen(port, () => console.log(`Server running on port ${port}`));
