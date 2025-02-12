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
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, user_id TEXT, name TEXT, email TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");
});

// Update the responses table to include a suggestion column
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY,
    guess TEXT,
    isCorrect BOOLEAN,
    user_id TEXT,
    suggestion TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Serve the login page
app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/views/login.html');
});

// Handle login form submission
app.post('/login', (req, res) => {
  const { user_id, name, email, security_answer } = req.body;

  // Check if the security answer is correct
  const correctSecurityAnswer = "Lee";  // Replace with the correct name of your department chairman
  if (security_answer.trim().toLowerCase() !== correctSecurityAnswer.toLowerCase()) {
    return res.send('<h2>Incorrect answer to the security question. Please try again.</h2>');
  }

  // Store the user details in the database
  db.run("INSERT INTO users (user_id, name, email) VALUES (?, ?, ?)", [user_id, name, email], function (err) {
    if (err) {
      console.log(err.message);
      return res.send("Error saving user details.");
    }
    console.log(`User logged in with ID ${this.lastID}`);
    
    // Save user data in session
    req.session.user = {
      id: this.lastID,  // The auto-generated database ID
      user_id,          // The user ID from the form
      name,             // The user's name
      email             // The user's email
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
  // Record the quiz start time if it hasn't been set
  if (!req.session.quizStartTime) {
    req.session.quizStartTime = Date.now();
  }
  res.sendF

