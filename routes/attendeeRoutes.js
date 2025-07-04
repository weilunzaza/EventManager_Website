const express = require('express');
const db = global.db;
const router = express.Router();

// Attendee homepage to list published events with organiser info
router.get('/home', (req, res) => {
    db.all(
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

            // For each event, get ticket info
            for (const event of events) {
                const tickets = await new Promise((resolve, reject) => {
                    db.all("SELECT * FROM tickets WHERE event_id = ?", [event.id], (err, rows) => {
                        if (err) return reject(err);
                        resolve(rows);
                    });
                });

                event.normalQty = 0;
                event.normalPrice = 0;
                event.concessionQty = 0;
                event.concessionPrice = 0;

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
            res.render('attendeeHomepage', { events });
        }
    );
});

// Show booking form for a specific event
router.get('/book/:id', (req, res) => {
    const eventID = req.params.id;
  
    db.get(
        `SELECT events.*, settings.organiser_name, settings.organiser_company 
        FROM events
        LEFT JOIN settings ON events.organiser_id = settings.organiser_id
        WHERE events.id = ? AND events.status = 'published'`,
        [eventID], 
        async (err, event) => {
            if (err || !event) {
                return res.status(404).render('errorPage', { message: 'Event not found or unpublished' });
            }
  
            const tickets = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM tickets WHERE event_id = ?", [eventID], 
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
  
            event.normalQty = 0;
            event.normalPrice = 0;
            event.concessionQty = 0;
            event.concessionPrice = 0;
        
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
  
    const normQty = parseInt(normalQty) || 0;
    const concQty = parseInt(concessionQty) || 0;
  
    if (!fullName || !email || (normQty + concQty <= 0)) {
      return res.status(400).render('errorPage', { message: 'Please complete all fields and select at least one ticket.' });
    }
  
    // Check ticket availability
    db.all("SELECT * FROM tickets WHERE event_id = ?", [eventID], (err, tickets) => {
        if (err) return res.status(500).render('errorPage', { message: 'Error checking tickets' });
  
        let availableNormal = 0;
        let availableConcession = 0;
  
        for (const ticket of tickets) {
            if (ticket.type === 'normal') availableNormal = ticket.quantity;
            if (ticket.type === 'concession') availableConcession = ticket.quantity;
        }
  
        if (normQty > availableNormal || concQty > availableConcession) {
            return res.status(400).render('errorPage', { message: 'Not enough tickets available' });
        }
  
        // Insert booking
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
                
                    res.render('successBook', { message: 'Booking confirmed!' });
            }
        );
    });
});


router.post('/checkout/:id', (req, res) => {
    const eventID = req.params.id;
    const { fullName, email, normalQty, concessionQty } = req.body;
  
    const normQty = parseInt(normalQty) || 0;
    const concQty = parseInt(concessionQty) || 0;
  
    if (!fullName || !email || (normQty + concQty <= 0)) {
        return res.status(400).render('errorPage', { message: 'Please complete all fields and select at least one ticket.' });
    }
  
    db.get("SELECT * FROM events WHERE id = ? AND status = 'published'", [eventID], (err, event) => {
        if (err || !event) {
            return res.status(500).render('errorPage', { message: 'Event not found.' });
        }
  
        // Get ticket prices from the tickets table
        db.all("SELECT * FROM tickets WHERE event_id = ?", [eventID], (err, tickets) => {
            if (err || !tickets.length) {
                return res.status(500).render('errorPage', { message: 'Tickets not found for this event.' });
            }
  
            let normalPrice = 0;
            let concessionPrice = 0;
  
            for (const ticket of tickets) {
                if (ticket.type === 'normal') normalPrice = ticket.price;
                if (ticket.type === 'concession') concessionPrice = ticket.price;
            }
  
            const total = (normQty * normalPrice) + (concQty * concessionPrice);
  
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
