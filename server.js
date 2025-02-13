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
  secret: 'mySecretKey', // Replace with a secure random string in production
  resave: false,
  saveUninitialized: false
}));

// Set up SQLite database
const db = new sqlite3.Database('quiz.db');

// Create table for storing users (if it doesn't exist)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, 
    copr_section TEXT, 
    name TEXT, 
    email TEXT, 
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Update the responses table to include COPR section & suggestion
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

// NEW ROOT ROUTE: Redirect requests from "/" to "/login"
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

  // Check if the security answer is correct
  const correctSecurityAnswer = "Lee";  // Replace with the correct chairman's name
  if (security_answer.trim().toLowerCase() !== correctSecurityAnswer.toLowerCase()) {
    return res.send('<h2>Incorrect answer to the security question. Please try again.</h2>');
  }

  // Store user details in the database
  db.run("INSERT INTO users (copr_section, name, email) VALUES (?, ?, ?)", [copr_section, name, email], function (err) {
    if (err) {
      console.log(err.message);
      return res.send("Error saving user details.");
    }
    console.log(`User logged in with ID ${this.lastID}`);
    
    // Save user data in session
    req.session.user = {
      id: this.lastID,
      copr_section,
      name,
      email
    };

    // Redirect to the quiz page
    res.redirect('/quiz');
  });
});

// Serve the quiz page (protected by session check)
app.get('/quiz', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  // Set the quiz start time when the user accesses the quiz
  req.session.quizStartTime = Date.now();

  res.sendFile(__dirname + '/views/quiz.html');
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.send("Error logging out.");
    }
    res.redirect('/login');
  });
});

// Route to handle quiz submissions
app.post('/submit', (req, res) => {
  if (!req.session.quizStartTime) {
    return res.send("Error: Quiz start time is missing. Please restart the quiz.");
  }

  const quizStartTime = req.session.quizStartTime;
  const now = Date.now();
  const timeElapsed = (now - quizStartTime) / 1000; // Convert to seconds

  console.log(`Time Elapsed: ${timeElapsed} seconds`);

  if (timeElapsed > 180) { // 180 seconds = 3 minutes
    return res.send("Time's up! You took too long to answer.");
  }

  const userGuess = req.body.guess.trim().toLowerCase(); // Normalize user input
  const correctAnswers = ["cat", "kitty", "feline"]; // List of acceptable answers
  const isCorrect = correctAnswers.includes(userGuess); // Check if response is correct

  const user = req.session.user;
  const copr_section = user ? user.copr_section : 'unknown';
  const name = user ? user.name : 'unknown';

  // Default score for correct answers
  let score = isCorrect ? 5 : 0;

  // If the user is in Peds, IR, MSK, or Emergency, increase score to 6
  const bonusSections = ["Peds", "IR", "MSK", "Emergency"];
  if (isCorrect && bonusSections.includes(copr_section)) {
    score = 6;
  }

  // Save response
  db.run("INSERT INTO responses (guess, isCorrect, copr_section, name, score) VALUES (?, ?, ?, ?, ?)",
    [userGuess, isCorrect, copr_section, name, score],
    function (err) {
      if (err) {
        console.log(err.message);
        return res.send("There was an error saving your response.");
      }
      console.log(`Response saved with ID ${this.lastID}`);

      // Fetch leaderboard data to pass to the results page
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

      db.all(sectionSQL, [], (err, leaderboardRows) => {
        if (err) {
          console.log(err.message);
          return res.send("Error retrieving leaderboard data.");
        }

        // Render the results page with leaderboard
        res.render('results', {
          result: isCorrect,  
          userGuess: req.body.guess,
          correctAnswer: correctAnswers.join(", "),
          explanation: "Cats are small, carnivorous mammals that have been domesticated for thousands of years.",
          responseId: this.lastID,
          leaderboard: leaderboardRows // Pass leaderboard data to the results page
        });
      });
  });
});

// **Leaderboard Route - COPR Sections (Top 5 Responses Counted, Correct or Incorrect)**
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
