const express = require('express');
const db = global.db;
const router = express.Router();

// Attendee homepage to list published events with organiser info
router.get('/home', (req, res) => {
    //Query to fetch all published events and join with organiser and settings info
    db.all(
        //Selects all columns from the events table
        //Retrieves organiser's username and renames it to organiser_username for clarity
        //Fetch additional display details from the settings table like organiser name and company
        //then INNER JOIN requires a matching organiser for each event
        `SELECT events.*,
            organisers.username AS organiser_username,
            settings.organiser_name,
            settings.organiser_company 
        FROM events
        JOIN organisers ON events.organiser_id = organisers.id
        LEFT JOIN settings ON organisers.id = settings.organiser_id
        WHERE events.status = 'published'
        ORDER BY events.date ASC`, 
        async (err, events) => {
            if (err) {
                console.error(err);
                return res.status(500).render('errorPage', { message: 'Unable to fetch events' });
            }

            // For each event, fetch ticket info
            for (const event of events) {
                //Fetch ticket data (normal and concession) for the event
                const tickets = await new Promise((resolve, reject) => {
                    db.all("SELECT * FROM tickets WHERE event_id = ?", [event.id], (err, rows) => {
                        if (err) return reject(err);
                        resolve(rows);
                    });
                });
                //Initialise ticket quantities and prices to 0
                event.normalQty = 0;
                event.normalPrice = 0;
                event.concessionQty = 0;
                event.concessionPrice = 0;

                //Assign ticket quantities and prices based on type
                for (const ticket of tickets) {
                    if (ticket.type === 'normal') {
                        event.normalQty = ticket.quantity;
                        event.normalPrice = ticket.price;
                    } else if (ticket.type === 'concession') {
                        event.concessionQty = ticket.quantity;
                        event.concessionPrice = ticket.price;
                    }
                }
            }
            //Render the homepage and pass the enriched events array to the template
            res.render('attendeeHomepage', { events });
        }
    );
});

// Show booking form for a specific event
router.get('/book/:id', (req, res) => {
    //Extract the event ID from parameter
    const eventID = req.params.id;
  
    db.get(
        //Selects all columns from the events table and custom name and company name
        //LEFT JOIN allows for events to still show up even if the organiser have not filled out their settings
        //Ensures that only published events can be booked
        `SELECT events.*, settings.organiser_name, settings.organiser_company 
        FROM events
        LEFT JOIN settings ON events.organiser_id = settings.organiser_id
        WHERE events.id = ? AND events.status = 'published'`,
        [eventID], 
        async (err, event) => { //Handling the error
            if (err || !event) {
                return res.status(404).render('errorPage', { message: 'Event not found or unpublished' });
            }
            //fetch all tickets for the selected event
            //use await and promise wrapper to make it compatible with async call back handling
            const tickets = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM tickets WHERE event_id = ?", [eventID], 
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
            //initialise to 0
            event.normalQty = 0;
            event.normalPrice = 0;
            event.concessionQty = 0;
            event.concessionPrice = 0;
            //loops through the returned tickets and populates the event object with quantity and price of normal and concession ticket types
            for (const ticket of tickets) {
                if (ticket.type === 'normal') {
                    event.normalQty = ticket.quantity;
                    event.normalPrice = ticket.price;
                } else if (ticket.type === 'concession') {
                    event.concessionQty = ticket.quantity;
                    event.concessionPrice = ticket.price;
                }
            }
            res.render('bookEvent', { event });
        }
    );
});

// Handle ticket booking submission
router.post('/book/:id', (req, res) => {
    const eventID = parseInt(req.params.id); //ensuring that this is an integer as eventID is a number
    const { fullName, email, normalQty, concessionQty } = req.body;
    
    //converting the ticket quantities to integers defaulting to 0 if empty
    const normQty = parseInt(normalQty) || 0;
    const concQty = parseInt(concessionQty) || 0;
    
    //validation for name and email must be provided and 
    //at least one ticket must be selected
    if (!fullName || !email || (normQty + concQty <= 0)) {
      return res.status(400).render('errorPage', { message: 'Please complete all fields and select at least one ticket.' });
    }
  
    // Check ticket availability
    db.all("SELECT * FROM tickets WHERE event_id = ?", [eventID], (err, tickets) => { //Fetching all the ticket types for this event
        //Handling error
        if (err) return res.status(500).render('errorPage', { message: 'Error checking tickets' });
        
        let availableNormal = 0;
        let availableConcession = 0;
        
        //loops through ticket types to get current availability
        for (const ticket of tickets) {
            if (ticket.type === 'normal') availableNormal = ticket.quantity;
            if (ticket.type === 'concession') availableConcession = ticket.quantity;
        }
        //checks that the user's requested quantity does not exceed stock
        //Prevents overbooking as well
        if (normQty > availableNormal || concQty > availableConcession) {
            return res.status(400).render('errorPage', { message: 'Not enough tickets available' });
        }
  
        // Insert booking
        //Purpose is to saves the booking into bookings table with all details
        db.run(
            `INSERT INTO bookings (event_id, full_name, email, normal_qty, concession_qty)
            VALUES (?, ?, ?, ?, ?)`,
            [eventID, fullName, email, normQty, concQty], 
            function (err) {
                if (err) {
                    console.error(err);
                    return res.status(500).render('errorPage', { message: 'Error saving booking' });
                }
  
                // Reduce ticket stock
                db.run(
                    `UPDATE tickets SET quantity = quantity - ? WHERE event_id = ? AND type = 'normal'`,
                    [normQty, eventID]);

                db.run(
                    `UPDATE tickets SET quantity = quantity - ? WHERE event_id = ? AND type = 'concession'`,
                    [concQty, eventID]);
                //Renders success page upon confirmation
                res.render('successBook', { message: 'Booking confirmed!' });
            }
        );
    });
});

//Checkout page before final booking
router.post('/checkout/:id', (req, res) => {
    const eventID = req.params.id;
    //Extract form data submitted by the user
    const { fullName, email, normalQty, concessionQty } = req.body;
    
    //Making sure the quantities are integers
    const normQty = parseInt(normalQty) || 0;
    const concQty = parseInt(concessionQty) || 0;
    
    //Basic validation to ensure name email and at least one ticket is selected
    if (!fullName || !email || (normQty + concQty <= 0)) {
        return res.status(400).render('errorPage', { message: 'Please complete all fields and select at least one ticket.' });
    }
    
    //Retrieve the event from database to ensure its valid and published
    db.get("SELECT * FROM events WHERE id = ? AND status = 'published'", [eventID], (err, event) => {
        if (err || !event) {
            return res.status(500).render('errorPage', { message: 'Event not found.' });
        }
  
        //Get ticket prices for the selected event
        db.all("SELECT * FROM tickets WHERE event_id = ?", [eventID], (err, tickets) => {
            if (err || !tickets.length) {
                return res.status(500).render('errorPage', { message: 'Tickets not found for this event.' });
            }
            
            //initialise it to 0
            let normalPrice = 0;
            let concessionPrice = 0;
            
            //loops through and assign ticket prices by type
            for (const ticket of tickets) {
                if (ticket.type === 'normal') normalPrice = ticket.price;
                if (ticket.type === 'concession') concessionPrice = ticket.price;
            }
            
            //calculate the total cost for all selected tickets
            const total = (normQty * normalPrice) + (concQty * concessionPrice);
            
            //render checkout page with all details populated
            res.render('checkoutPage', {
                event,
                fullName,
                email,
                normalQty: normQty,
                concessionQty: concQty,
                normalPrice,
                concessionPrice,
                total
            });
        });
    });
});
  
  

module.exports = router;
