const express = require('express');
const bcrypt = require('bcrypt');
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
    //Destructure username and password from the submitted form data
    const { username, password } = req.body;

    //look up the organiser in the database by their username
    db.get("SELECT * FROM organisers WHERE username = ?", [username], (err, organiser) => {
        //if error or organiser does not exists, show Invalid Credentials
        if (err || !organiser) {
            return res.status(500).render('errorPage', { message: 'Invalid credentials' });
        }

        //Compare the submitted password with the hashed password stored in the database
        //uses bcrypt to securely compare the submitted password with the hashed one
        bcrypt.compare(password, organiser.password, (err, result) => {
            if (result) {
                //If password matches, set session variables to log the user in
                req.session.isLoggedIn = true; //indicates user is logged in
                req.session.organiserID = organiser.id; //stores organiser's ID for future use
                res.redirect('/organiser/home'); //redirect to organiser dashboard
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

     //Check if username already exists
    db.get("SELECT * FROM organisers WHERE username = ?", [username], (err, existingUser) => {
        if (err) {
            console.error("registration DB error: ", err);
            return res.status(500).send("Database error");
        }
        if (existingUser) {
            //if username exists, show error page
            return res.render('errorPage', { message: "Username already taken" });
        }

        //Hash the password using bcrypt
        bcrypt.hash(password, 10, (err, hash) => {
            if (err) return res.status(500).send("Error hashing password");

            //Insert the new organiser into the database with the hashed password
            db.run("INSERT INTO organisers (username, password) VALUES (?, ?)", [username, hash], (err) => {
                if (err) return res.status(500).send("Error saving organiser");

                //Redirect to login if registration successful
                res.redirect('/organiser/login');
            });
        });
    });
});

//Organiser dashboard route
router.get('/home', (req, res) => {
    const organiserID = req.session.organiserID;
    
    //Redirect if organiser not authenticated
    if (!organiserID) {
      return res.redirect('/organiser/login');
    }
    
    //Retrieve organiser details using the ID from session
    db.get("SELECT * FROM organisers WHERE id = ?", [organiserID], (err, organiser) => {
        if (err || !organiser) {
            return res.status(500).render('errorPage', { message: 'Unable to load organiser info' });
        }
        
        //Retrieve organiser's custom settings like name and company
        db.get("SELECT * FROM settings WHERE organiser_id = ?", [organiserID], 
        (err, settings) => {
            // Use fallback values if settings not found
            const organiserName = settings?.organiser_name || "Example Organiser";
            const organiserCompany = settings?.organiser_company || "Example Company";
            
            //Retrieve all events created by this organiser
            db.all("SELECT * FROM events WHERE organiser_id = ?", [organiserID], async (err, events) => {
                if (err) {
                    return res.status(500).render('errorPage', { message: 'Unable to fetch events' });
                }
                
                const draftEvents = [];
                const publishedEvents = [];
                
                //for each event get ticket information, normal and concession
                for (const event of events) {
                    const tickets = await new Promise((resolve, reject) => {
                        db.all("SELECT * FROM tickets WHERE event_id = ?", [event.id], (err, rows) => {
                            if (err) return reject(err);
                            resolve(rows);
                        });
                    });
                    
                    //Initializing ticket info to 0 
                    event.normalQty = 0;
                    event.concessionQty = 0;
                    event.normalPrice = 0;
                    event.concessionPrice = 0;
                    
                    //Assign ticket quantities and prices based on type
                    for (const ticket of tickets) {
                        if (ticket.type === 'normal') {
                            event.normalQty = ticket.quantity;
                            event.normalPrice = ticket.price;
                        }
                        if (ticket.type === 'concession') {
                            event.concessionQty = ticket.quantity;
                            event.concessionPrice = ticket.price;
                        }
                    }
                    
                    //Categorize event into published or draft
                    if (event.status === 'published') {
                        publishedEvents.push(event);
                    } else {
                        draftEvents.push(event);
                    }
                }
                
                //Render the organiser homepage with all relevant info
                res.render('organiserHomepage', {
                    organiserName, // from settings or fallback
                    organiserCompany, // from settings or fallback
                    siteName: 'Event Organiser',
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
    if (!req.session.organiserID) {
       return res.redirect('/organiser/login');
    }
    res.render('createEvent');
});

//POST create Event page which handles the creation of a new event with ticket types
router.post('/create', (req, res) => {
    //extract form inputs from the request body
    const { title, description, date, normalQty, normalPrice, concessionQty, concessionPrice } = req.body;
    const organiserID = req.session.organiserID;
    
    //Insert the new event into the 'events' table with 'draft' status
    db.run(
      `INSERT INTO events (organiser_id, title, description, date, status, created_at)
       VALUES (?, ?, ?, ?, 'draft', datetime('now'))`, [organiserID, title, description, date], 
        function(err) {
            if (err) {
                console.error(err);
                return res.status(500).render('errorPage', { message: 'Error saving event' });
            }
            
            //storing the newly created event's ID for inserting tickets
            const eventID = this.lastID;
            
            //Prepare statement for inserting tickets associated with this event
            const insertTickets = db.prepare(`INSERT INTO tickets (event_id, type, quantity, price) VALUES (?, ?, ?, ?)`);
            
            //Insert normal ticket info
            insertTickets.run(eventID, 'normal', parseInt(normalQty) || 0, parseFloat(normalPrice) || 0);
            //Insert concession ticket info
            insertTickets.run(eventID, 'concession', parseInt(concessionQty) || 0, //using 0 if invalid or empty
            parseFloat(concessionPrice) || 0);
            
            //Finalised statement to ensure insertion
            insertTickets.finalize((err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).render('errorPage', { message: 'Error saving ticket info' });
                }
                //upon success, redirect to organiser home
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
        (err) => {
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
  
    db.run("DELETE FROM events WHERE id = ? AND organiser_id = ?",
    [eventID, organiserID],
    (err) => {
        if (err) {
          console.error("Delete error:", err);
          return res.status(500).render('errorPage', { message: 'Failed to delete event' });
        }
        res.redirect('/organiser/home');
    });
});
  
//Edit Events
router.get('/edit/:id', (req, res) => {
    const organiserID = req.session.organiserID;
    const eventID = req.params.id;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    // First get the event
    db.get(
        `SELECT * FROM events WHERE id = ? AND organiser_id = ?`,
        [eventID, organiserID],
        (err, event) => {
            if (err || !event) {
                return res.status(500).render('errorPage', { message: 'Failed to load event for editing' });
            }
  
            // Then get its tickets
            db.all(`SELECT * FROM tickets WHERE event_id = ?`, [eventID], (err, tickets) => {
                if (err) {
                    console.error(err);
                    return res.status(500).render('errorPage', { message: 'Failed to load ticket info' });
                }
                // Attach ticket info
                for (const ticket of tickets) {
                    if (ticket.type === 'normal') {
                        event.normalQty = ticket.quantity;
                        event.normalPrice = ticket.price;
                    } else if (ticket.type === 'concession') {
                        event.concessionQty = ticket.quantity;
                        event.concessionPrice = ticket.price;
                    }
                }
                res.render('editEvent', { event });
            });
        }
    );
});

//Handle event edit form submission (including both ticket types)
router.post('/edit/:id', (req, res) => {
    const organiserID = req.session.organiserID;
    const eventID = req.params.id;
    const { title, description, date, normalQty, normalPrice, concessionQty, concessionPrice } = req.body;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    db.serialize(() => {
        // Update the event info
        db.run(
            `UPDATE events SET title = ?, description = ?, date = ? WHERE id = ? AND organiser_id = ?`,
            [title, description, date, eventID, organiserID],
            (err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).render('errorPage', { message: 'Error updating event' });
                }
            }
        );
        // Update normal ticket
        db.run(
            `UPDATE tickets SET quantity = ?, price = ? WHERE event_id = ? AND type = 'normal'`,
            [parseInt(normalQty) || 0, parseFloat(normalPrice) || 0, eventID],
            (err) => {
                if (err) {
                    console.error("Normal ticket update error:", err);
                    return res.status(500).render('errorPage', { message: 'Error updating normal ticket info' });
                }
            }
        );
        // Update concession ticket
        db.run(
            `UPDATE tickets SET quantity = ?, price = ? WHERE event_id = ? AND type = 'concession'`,
            [parseInt(concessionQty) || 0, parseFloat(concessionPrice) || 0, eventID],
            (err) => {
                if (err) {
                    console.error("Concession ticket update error:", err);
                    return res.status(500).render('errorPage', { message: 'Error updating concession ticket info' });
                }
                // All good, redirect
                res.redirect('/organiser/home');
            }
        );
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
  
//GET organiser settings page
router.get('/settings', (req, res) => {
    const organiserID = req.session.organiserID;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    db.get(`SELECT * FROM settings WHERE organiser_id = ?`, [organiserID], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).render('errorPage', { message: 'Error loading settings' });
        }
  
        res.render('organiserSettings', {
            settings: row || {}
        });
    });
});
  
//POST update organiser settings
router.post('/settings', (req, res) => {
    const organiserID = req.session.organiserID;
    const { site_title, organiser_name, organiser_company } = req.body;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    // First, check if settings already exist
    db.get(`SELECT * FROM settings WHERE organiser_id = ?`, [organiserID], (err, existingSettings) => {
        if (err) {
            console.error(err);
            return res.status(500).render('errorPage', { message: 'Error loading settings' });
        }
    
        if (existingSettings) {
            // Update existing settings
            db.run(
                `UPDATE settings SET site_title = ?, organiser_name = ?, organiser_company = ? WHERE organiser_id = ?`,
                [site_title, organiser_name, organiser_company, organiserID],
                (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).render('errorPage', { message: 'Error updating settings' });
                    }
                    res.redirect('/organiser/home');
                }   
            );
        } else {
            // Insert new settings
            db.run(
                `INSERT INTO settings (organiser_id, site_title, organiser_name, organiser_company) VALUES (?, ?, ?, ?)`,
                [organiserID, site_title, organiser_name, organiser_company],
                (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).render('errorPage', { message: 'Error saving new settings' });
                    }
                    res.redirect('/organiser/home');
                }
            );
        }
    });
});
  
// View all bookings for organiser's events
router.get('/bookings', (req, res) => {
    const organiserID = req.session.organiserID;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    db.all(`
        SELECT 
            bookings.*, 
            events.title AS event_title 
        FROM bookings 
        JOIN events ON bookings.event_id = events.id
        WHERE events.organiser_id = ?
        ORDER BY bookings.created_at DESC`, 
        [organiserID], 
        (err, bookings) => {
            if (err) {
                console.error(err);
                return res.status(500).render('errorPage', { message: 'Error loading bookings' });
            }
            res.render('organiserBookings', { bookings });
        }
    );
});

  


module.exports = router;