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
        ORDER BY correct_count DESC, name ASC
        LIMIT 5;
      `;

      db.all(sectionSQL, [], (err, leaderboardRows) => {
        if (err) {
          console.log(err.message);
          return res.send("Error retrieving leaderboard data.");
        }

        db.all(individualSQL, [], (err, topPerformersRows) => {
          if (err) {
            console.log(err.message);
            return res.send("Error retrieving top performers data.");
          }

          res.render('results', {
            result: isCorrect,  
            userGuess: req.body.guess,
            correctAnswer: correctAnswers.join(", "), 
            explanation: explanation,  
            responseId: this.lastID,
            leaderboard: leaderboardRows,
            topPerformers: topPerformersRows 
          });
        });
      });
  });
});

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

process.on('SIGINT', () => {
  console.log("Shutting down server gracefully...");
  process.exit();
});

process.on('SIGTERM', () => {
  console.log("Shutting down server gracefully...");
  process.exit();
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
