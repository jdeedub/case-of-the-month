const session = require('express-session');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.set('view engine', 'ejs');  // Set the view engine AFTER creating the app

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
  res.sendFile(__dirname + '/views/quiz.html');
});

// Logout route: Destroys the session and redirects to login
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
  // Ensure the quiz start time exists in the session
  const quizStartTime = req.session.quizStartTime;
  const now = Date.now();
  if (!quizStartTime || (now - quizStartTime) > 180000) { // 180,000 ms = 3 minutes
    return res.send("Time's up! You took too long to answer.");
  }
  
  // Process the quiz submission if within time
  const userGuess = req.body.guess;
  const correctAnswer = 'cat';  // Replace with your actual correct answer
  const isCorrect = userGuess.trim().toLowerCase() === correctAnswer.toLowerCase();
  
  // Get the user from the session
  const user = req.session.user;
  const userId = user ? user.user_id : 'unknown';

  // Save the response to the database and then render the results page
  db.run("INSERT INTO responses (guess, isCorrect, user_id) VALUES (?, ?, ?)",
    [userGuess, isCorrect, userId],
    function (err) {
      if (err) {
        console.log(err.message);
        return res.send("There was an error saving your response.");
      }
      console.log(`A response has been saved with ID ${this.lastID}`);

      // Render the results page with the necessary data.
      res.render('results', {
        result: isCorrect,
        userGuess: userGuess,
        correctAnswer: correctAnswer,
        explanation: "Cats are small, carnivorous mammals that have been domesticated for thousands of years. They are known for their agility, independence, and playful behavior.",
        responseId: this.lastID  // Pass the response ID to the template for suggestions.
      });
  });
});

// New route to handle suggestion submissions
app.post('/suggest', (req, res) => {
  const { responseId, suggestion } = req.body;
  // Update the responses table, adding the suggestion for the given response ID.
  db.run("UPDATE responses SET suggestion = ? WHERE id = ?", [suggestion, responseId], function(err) {
    if (err) {
      console.log(err.message);
      return res.send("There was an error saving your suggestion.");
    }
    res.send("Thank you for your suggestion!");
  });
});

// Use the port provided by Heroku, or default to 3000 if not available.
const port = process.env.PORT || 3000;

// Start the server and listen on the specified port.
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
