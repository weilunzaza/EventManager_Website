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

//Publish Events -- Published a draft event
router.post('/publish/:id', (req, res) => {
    //Retrieve the organiser's ID from the current session
    const organiserID = req.session.organiserID;
    //Get the event ID from the route parameter
    const eventID = req.params.id;
    
    //return to login page if no organiser logged in
    if (!organiserID) return res.redirect('/organiser/login');
    
    //Update the event's status to become 'published' and log the timestap
    db.run(
        `UPDATE events SET status = 'published', published_at = datetime('now') WHERE id = ? AND organiser_id = ?`,
        [eventID, organiserID], 
        (err) => {
            if (err) {
                console.error(err);
                return res.status(500).render('errorPage', { message: 'Error publishing event' });
            }
            //success redirect to organiser homepage
            res.redirect('/organiser/home');
        }
    );
});

//Deleting events
router.post('/delete/:id', (req, res) => {
    //Retrieve the organiser's ID from the current session
    const organiserID = req.session.organiserID;
    //Getting the event ID from the route parameter
    const eventID = req.params.id;
    
    //redirect to organiser login if there is no organiser logged in
    if (!organiserID) return res.redirect('/organiser/login');
    
    //Delete the event from the database
    //Only deletes the event if it belongs to the currently logged in organiser
    db.run("DELETE FROM events WHERE id = ? AND organiser_id = ?",
    [eventID, organiserID],
    (err) => {
        if (err) {
          console.error("Delete error:", err);
          return res.status(500).render('errorPage', { message: 'Failed to delete event' });
        }
        //redirecting to organiser home page after successful deletion
        res.redirect('/organiser/home');
    });
});
  
//Edit Events
router.get('/edit/:id', (req, res) => {
    //Retrieve the organiser's ID from the current session
    const organiserID = req.session.organiserID;
    //Extract event ID from parameter
    const eventID = req.params.id;

    if (!organiserID) return res.redirect('/organiser/login');
  
    // Fetching the event from the database, making sure it belongs to the logged in organsier
    db.get(
        `SELECT * FROM events WHERE id = ? AND organiser_id = ?`,
        [eventID, organiserID],
        (err, event) => {
            if (err || !event) {
                return res.status(500).render('errorPage', { message: 'Failed to load event for editing' });
            }
  
            //After retrieving events, fetch associated ticket types
            db.all(`SELECT * FROM tickets WHERE event_id = ?`, [eventID], (err, tickets) => {
                if (err) {
                    console.error(err);
                    return res.status(500).render('errorPage', { message: 'Failed to load ticket info' });
                }
                //Need to loop through all the tickets and assign values to the event object so they can be pre populated in the form
                for (const ticket of tickets) {
                    if (ticket.type === 'normal') {
                        event.normalQty = ticket.quantity;
                        event.normalPrice = ticket.price;
                    } else if (ticket.type === 'concession') {
                        event.concessionQty = ticket.quantity;
                        event.concessionPrice = ticket.price;
                    }
                }
                //Render the editEvent.ejs page and pass the fill event object
                res.render('editEvent', { event });
            });
        }
    );
});

//Handle event edit form submission (including both ticket types)
router.post('/edit/:id', (req, res) => {
    const organiserID = req.session.organiserID;
    const eventID = req.params.id;
    //Extract updated form values from the request body
    const { title, description, date, normalQty, normalPrice, concessionQty, concessionPrice } = req.body;
  
    if (!organiserID) return res.redirect('/organiser/login');
    
    //Using serialize to ensure updates are run in order
    db.serialize(() => {
        // Update the event's basic info (title, description, date)
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
        // Update normal ticket info (quantity, price)
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
        // Update concession ticket info (quantity, price)
        db.run(
            `UPDATE tickets SET quantity = ?, price = ? WHERE event_id = ? AND type = 'concession'`,
            [parseInt(concessionQty) || 0, parseFloat(concessionPrice) || 0, eventID],
            (err) => {
                if (err) {
                    console.error("Concession ticket update error:", err);
                    return res.status(500).render('errorPage', { message: 'Error updating concession ticket info' });
                }
                // redirect to organiser home once all updates are done
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
    //retrieve organiser's session id
    const organiserID = req.session.organiserID;
  
    if (!organiserID) return res.redirect('/organiser/login');
    
    //Query the settings table for specific organiser
    db.get(`SELECT * FROM settings WHERE organiser_id = ?`, [organiserID], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).render('errorPage', { message: 'Error loading settings' });
        }
        //Render the settings page with existing settings
        res.render('organiserSettings', {
            settings: row || {} //fall back to empty object to prevent EJS errors
        });
    });
});
  
//POST update organiser settings
router.post('/settings', (req, res) => {
    const organiserID = req.session.organiserID;
    const { site_title, organiser_name, organiser_company } = req.body;
  
    if (!organiserID) return res.redirect('/organiser/login');
  
    // First, check if settings already exist for this organiser
    db.get(`SELECT * FROM settings WHERE organiser_id = ?`, [organiserID], (err, existingSettings) => {
        if (err) {
            console.error(err);
            return res.status(500).render('errorPage', { message: 'Error loading settings' });
        }
    
        if (existingSettings) {
            //if settings exist, update the settings
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
            //If there are no settings yet, insert new record
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
    
    //Query bookings that belong to events created by this organiser
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