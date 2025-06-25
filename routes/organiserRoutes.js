const express = require('express');
const bcrypt = require('bcrypt');
// const db = require('../database');
const db = global.db;
const router = express.Router();

//Middleware to check if the user is logged in
const checkAuth = (req, res, next) => {
    if (!req.session.isLoggedIn) {
        return res.redirect('/organiser/login');
    }
    next();
};

//organiser Login Page
router.get('/login', (req, res) => {
    res.render('organiserLogin');
});

//organiser Login Logic
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.get("SELECT * FROM organisers WHERE username = ?", [username], (err, organiser) => {
        if (err || !organiser) {
            return res.status(500).render('errorPage', { message: 'Invalid credentials' });
        }

        bcrypt.compare(password, organiser.password, (err, result) => {
            if (result) {
                req.session.isLoggedIn = true;
                req.session.organiserID = organiser.id;
                res.redirect('/organiser/home');
            } else {
                return res.status(500).render('errorPage', { message: 'Invalid credentials' });
            }
        });
    });
});

//organiser Register Page
router.get('/register', (req, res) => {
    res.render('organiserRegister');
});

//organiser Register Logic
router.post('/register', (req, res) => {
    const { username, password } = req.body;

     // Check if username already exists
     db.get("SELECT * FROM organisers WHERE username = ?", [username], (err, existingUser) => {
        if (err) {
            console.error("registration DB error: ", err);
            return res.status(500).send("Database error");
        }
        if (existingUser) {
            return res.render('errorPage', { message: "Username already taken" });
        }

        // Hash the password
        bcrypt.hash(password, 10, (err, hash) => {
            if (err) return res.status(500).send("Error hashing password");

            // Insert into the database
            db.run("INSERT INTO organisers (username, password) VALUES (?, ?)", [username, hash], function(err) {
                if (err) return res.status(500).send("Error saving organiser");

                // Redirect to login
                res.redirect('/organiser/login');
            });
        });
    });
    // bcrypt.hash(password, 10, (err, hashedPassword) => {
    //     if (err) {
    //         return res.status(500).render('errorPage', { message: 'Error creating hashed password' });
    //     }

    //     db.run("INSERT INTO organisers (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
    //         if (err) {
    //             return res.status(500).render('errorPage', { message: 'Error creating user' });
    //         }

    //         const organiserId = this.lastID;

    //         db.run("INSERT INTO settings (organiser_id, site_name, organiser_name) VALUES (?, ?, ?)",
    //             [organiserId, 'My Event Portal', username],
    //             (err) => {
    //                 if (err) {
    //                     return res.status(500).render('errorPage', { message: 'Error creating default settings' });
    //                 }
    //                 res.redirect('/organiser/login');
    //             }
    //         );
    //     });
    // });
});

// Temporary organiser dashboard route
router.get('/home', (req, res) => {
    const organiserID = req.session.organiserID;
  
    if (!organiserID) {
      return res.redirect('/organiser/login');
    }
  
    db.get("SELECT * FROM organisers WHERE id = ?", [organiserID], (err, organiser) => {
      if (err || !organiser) {
        return res.status(500).render('errorPage', { message: 'Unable to load organiser info' });
      }
  
      db.all("SELECT * FROM events WHERE organiser_id = ? AND status = 'draft'", [organiserID], (err, draftEvents) => {
        if (err) {
          return res.status(500).render('errorPage', { message: 'Unable to fetch draft events' });
        }
  
        // Optional: also load published events if needed
        db.all("SELECT * FROM events WHERE organiser_id = ? AND status = 'published'", [organiserID], (err, publishedEvents) => {
          if (err) {
            return res.status(500).render('errorPage', { message: 'Unable to fetch published events' });
          }
  
          res.render('organiserHomepage', {
            organiserName: organiser.username,
            siteName: 'EventManager 3000',
            siteDescription: 'Your go-to portal for awesome events!',
            draftEvents,
            publishedEvents
          });
        });
      });
    });
  });
  

//GET create event page
router.get('/create', (req, res) => {
    if (!req.session.organiserID) return res.redirect('/organiser/login');
    res.render('createEvent');
  });

  //POST create Event page
  router.post('/create', (req, res) => {
    const { title, description, date } = req.body;
    const organiserID = req.session.organiserID;
  
    db.run(`INSERT INTO events (organiser_id, title, description, date, status, created_at)
            VALUES (?, ?, ?, ?, 'draft', datetime('now'))`,
      [organiserID, title, description, date],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).render('errorPage', { message: 'Error saving event' });
        }
        res.redirect('/organiser/home');
      }
    );
  });

  //Publish Events
router.post('/publish/:id', (req, res) => {
    const organiserID = req.session.organiserID;
    const eventID = req.params.id;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    db.run(
      `UPDATE events SET status = 'published', published_at = datetime('now') WHERE id = ? AND organiser_id = ?`,
      [eventID, organiserID],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).render('errorPage', { message: 'Error publishing event' });
        }
        res.redirect('/organiser/home');
      }
    );
  });

  //Deleting events
router.post('/delete/:id', (req, res) => {
    const organiserID = req.session.organiserID;
    const eventID = req.params.id;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    db.run(
      "DELETE FROM events WHERE id = ? AND organiser_id = ?",
      [eventID, organiserID],
      function (err) {
        if (err) {
          console.error("Delete error:", err);
          return res.status(500).render('errorPage', { message: 'Failed to delete event' });
        }
        res.redirect('/organiser/home');
      }
    );
  });
  
  


module.exports = router;