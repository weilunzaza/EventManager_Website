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

//Organiser dashboard route
router.get('/home', (req, res) => {
    const organiserID = req.session.organiserID;
  
    if (!organiserID) {
      return res.redirect('/organiser/login');
    }
  
    db.get("SELECT * FROM organisers WHERE id = ?", [organiserID], (err, organiser) => {
      if (err || !organiser) {
        return res.status(500).render('errorPage', { message: 'Unable to load organiser info' });
      }
  
      db.all("SELECT * FROM events WHERE organiser_id = ?", [organiserID], async (err, events) => {
        if (err) {
          return res.status(500).render('errorPage', { message: 'Unable to fetch events' });
        }
  
        const draftEvents = [];
        const publishedEvents = [];
  
        for (const event of events) {
          // Get ticket quantities
          const tickets = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM tickets WHERE event_id = ?", [event.id], (err, rows) => {
              if (err) return reject(err);
              resolve(rows);
            });
          });
  
          event.normalQty = 0;
          event.concessionQty = 0;
  
          for (const ticket of tickets) {
            if (ticket.type === 'normal') event.normalQty = ticket.quantity;
            if (ticket.type === 'concession') event.concessionQty = ticket.quantity;
          }
  
          if (event.status === 'published') {
            publishedEvents.push(event);
          } else {
            draftEvents.push(event);
          }
        }
  
        res.render('organiserHomepage', {
          organiserName: organiser.username,
          siteName: 'Event Organiser',
          siteDescription: 'Your go-to portal for awesome events!',
          draftEvents,
          publishedEvents
        });
      });
    });
  });
  
  

//GET create event page
router.get('/create', (req, res) => {
    if (!req.session.organiserID) return res.redirect('/organiser/login');
    res.render('createEvent');
  });

// POST create Event page
router.post('/create', (req, res) => {
    const { title, description, date, normalQty, concessionQty } = req.body;
    const organiserID = req.session.organiserID;
  
    db.run(
      `INSERT INTO events (organiser_id, title, description, date, status, created_at)
       VALUES (?, ?, ?, ?, 'draft', datetime('now'))`,
      [organiserID, title, description, date],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).render('errorPage', { message: 'Error saving event' });
        }
  
        const eventID = this.lastID;
  
        // Insert both normal and concession tickets
        const insertTickets = db.prepare(`INSERT INTO tickets (event_id, type, quantity, price) VALUES (?, ?, ?, ?)`);
  
        insertTickets.run(eventID, 'normal', parseInt(normalQty) || 0, 5.0);
        insertTickets.run(eventID, 'concession', parseInt(concessionQty) || 0, 50.0);
  
        insertTickets.finalize((err) => {
          if (err) {
            console.error(err);
            return res.status(500).render('errorPage', { message: 'Error saving ticket info' });
          }
  
          res.redirect('/organiser/home');
        });
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
  
// Edit Events (with ticket quantity included)
router.get('/edit/:id', (req, res) => {
    const organiserID = req.session.organiserID;
    const eventID = req.params.id;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    db.get(
      `SELECT e.*, t.quantity AS ticketCount
       FROM events e
       LEFT JOIN tickets t ON e.id = t.event_id
       WHERE e.id = ? AND e.organiser_id = ?`,
      [eventID, organiserID],
      (err, event) => {
        if (err || !event) {
          return res.status(500).render('errorPage', { message: 'Failed to load event for editing' });
        }
        // Default ticketCount to 0 if no ticket record exists
        event.ticketCount = event.ticketCount || 0;
        res.render('editEvent', { event });
      }
    );
  });

// Handle event edit form submission (including both ticket types)
router.post('/edit/:id', (req, res) => {
    const organiserID = req.session.organiserID;
    const eventID = req.params.id;
    const { title, description, date, normalQty, concessionQty } = req.body;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    if (
      isNaN(normalQty) || normalQty < 0 ||
      isNaN(concessionQty) || concessionQty < 0
    ) {
      return res.status(400).render('errorPage', { message: 'Invalid ticket quantities' });
    }
  
    db.serialize(() => {
      // Update event info
      db.run(
        `UPDATE events SET title = ?, description = ?, date = ? WHERE id = ? AND organiser_id = ?`,
        [title, description, date, eventID, organiserID],
        function (err) {
          if (err) {
            console.error(err);
            return res.status(500).render('errorPage', { message: 'Error updating event' });
          }
        }
      );
  
      // Upsert tickets for each type
      const upsertTicket = (type, qty, price, callback) => {
        db.get(`SELECT * FROM tickets WHERE event_id = ? AND type = ?`, [eventID, type], (err, row) => {
          if (err) return callback(err);
  
          if (row) {
            db.run(
              `UPDATE tickets SET quantity = ?, price = ? WHERE event_id = ? AND type = ?`,
              [qty, price, eventID, type],
              callback
            );
          } else {
            db.run(
              `INSERT INTO tickets (event_id, type, quantity, price) VALUES (?, ?, ?, ?)`,
              [eventID, type, qty, price],
              callback
            );
          }
        });
      };
  
      upsertTicket('normal', parseInt(normalQty), 5.0, (err) => {
        if (err) {
          console.error(err);
          return res.status(500).render('errorPage', { message: 'Error saving normal ticket' });
        }
  
        upsertTicket('concession', parseInt(concessionQty), 50.0, (err) => {
          if (err) {
            console.error(err);
            return res.status(500).render('errorPage', { message: 'Error saving concession ticket' });
          }
  
          // All good
          res.redirect('/organiser/home');
        });
      });
    });
  });
  
  
  
  
  //Logout Button Route
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).render('errorPage', { message: 'Error logging out' });
      }
      //main code which redirect to '/' which is firstPage.ejs
      res.redirect('/');
    });
  });
  
  
  


module.exports = router;