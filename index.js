
// Set up express, bodyparser and EJS
const express = require('express');
const app = express();
const port = 3000;
const path = require('path')
var bodyParser = require("body-parser");
const session = require('express-session');
app.use(session({
    secret: 'your-secret-key', //use an environment variable in production
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } //secure should be true only with HTTPS
  }));
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs'); // set the app to use ejs for rendering
//app.set('views', path.join(__dirname, 'views')); //for some reason if i use this i will not have the correct style
app.use(express.static(path.join(__dirname, 'public')));



// Set up SQLite
// Items in the global namespace are accessible throught out the node application
const sqlite3 = require('sqlite3').verbose();
global.db = new sqlite3.Database('./database.db',function(err){
    if(err){
        console.error(err);
        process.exit(1); // bail out we can't connect to the DB
    } else {
        console.log("Database connected");
        global.db.run("PRAGMA foreign_keys=ON"); // tell SQLite to pay attention to foreign key constraints
    }
});

// Handle requests to the home page 
app.get('/', (req, res) => {
    //res.send('Hello World!')
    res.render('firstPage')
});

// Add all the route handlers in usersRoutes to the app under the path /users
const usersRoutes = require('./routes/users');
app.use('/users', usersRoutes);
const organiserRoutes = require('./routes/organiserRoutes');
app.use('/organiser', organiserRoutes);


// Make the web application listen for HTTP requests
app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

