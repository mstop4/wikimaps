"use strict"

require("dotenv").config()

const PORT        = process.env.PORT || 8080
const ENV         = process.env.ENV || "development"
const GOOGLEMAPS_APIKEY = process.env.GOOGLEMAPS_APIKEY
const express     = require("express")
const bodyParser  = require("body-parser")
const sass        = require("node-sass-middleware")
const app         = express()
const knexConfig  = require("./knexfile")
const knex        = require("knex")(knexConfig[ENV])
const morgan      = require("morgan")
const knexLogger  = require("knex-logger")
const passport    = require("passport")
const Strategy    = require("passport-local").Strategy
const db          = require("./db")
const bcrypt      = require("bcrypt-nodejs")
// Seperated Routes for each Resource
const usersRoutes = require("./routes/users")

// Load the logger first so all (static) HTTP requests are logged to STDOUT
// "dev" = Concise output colored by response status for development use.
//         The :status token will be colored red for server error codes, yellow for client error codes, cyan for redirection codes, and uncolored for all other codes.
app.use(morgan("dev"))

// Log knex SQL queries to STDOUT as well
app.use(knexLogger(knex))

app.set("views", __dirname + "/views")
app.set("view engine", "ejs")
app.use(bodyParser.urlencoded({ extended: true}))
app.use("/styles", sass({
  src: __dirname + "/styles",
  dest: __dirname + "/public/styles",
  debug: true,
  outputStyle: "expanded"
}))
app.use(express.static("public"))
app.use("/js", express.static(__dirname + "/node_modules/bootstrap/dist/js")) // redirect bootstrap JS
app.use(require("cookie-parser")())
app.use(require("body-parser").urlencoded({ extended: true}))
app.use(require("express-session")({ secret: "moist", resave: false, saveUninitialized: false}))

// Mount all resource routes
app.use("/api/users", usersRoutes(knex))

// Loads the page and initializes keys and data
function renderHelper(req, res) {
  let templateVars = {}
  let whereClause = ""

  if (req.user) {
    templateVars = {
      googleMapsAPIKey: GOOGLEMAPS_APIKEY,
      user: req.user
    }
    whereClause = {user_id: req.user.id,
      favourite: true
    }
  } else {
    templateVars = {
      googleMapsAPIKey: GOOGLEMAPS_APIKEY,
      user: {
        id:0,
        name:"Guest",
        email:"guest@guest.com",
        password:"none"
      }
    }
    whereClause = {
      user_id: 0,
      favourite: true
    }
  }

  // get favourites
  knex("users_maps")
  .where(whereClause)
  .select("map_id")
  .then((results) => {
    templateVars["favourites"] = results
    res.render("index", templateVars)
  })
}

// Gets a contribution by user
app.get("/contributions/:user_id", (req, res) => {
  knex("maps")
  .join("users_maps", "maps.id", "=", "users_maps.map_id")
  .where({user_id: req.params.user_id})
  .andWhere("contribution", true)
  .select("id")
  .select("title")
  .then((results) => {
    res.json(results)
  })
  .catch(function(error) {
    console.log(error)
  })
})

// Toggles a favourite in the database
app.put("/favourites", (req, res) => {
  knex("users_maps")
  .where({
    map_id: req.query.map_id,
    user_id: req.query.user_id
  })
  .select("favourite")
  .then((results) =>{
    if (results.length === 0) {
      knex("users_maps")
      .insert({
        user_id: req.query.user_id,
        map_id: req.query.map_id,
        favourite: req.query.state,
        contribution: false
      })
      .then((results) => {
        res.json(results)
      })
      .catch((error) => {
        console.log(error)
      })
    } else {
      knex("users_maps")
      .where({
        map_id: req.query.map_id,
        user_id: req.query.user_id
      })
      .update({favourite : req.query.state})
      .returning("user_id")
      .then( (user_id)=> {
        res.json(results)
      })
      .catch((error) => {
        console.log(error)
      })
    }
  })
})

// Gets all favourited maps by user
app.get("/favourites/:user_id", (req, res) => {
  knex("maps")
  .join("users_maps", "maps.id", "=", "users_maps.map_id")
  .where({user_id: req.params.user_id})
  .andWhere("favourite", true)
  .select("id")
  .select("title")
  .then((results) => {
    res.json(results)
  })
  .catch(function(error) {
    console.log(error)
  })
})

// Gets all users
app.get("/users", (req, res) => {
  knex("users")
  .then((results) => {
    res.json(results)
  })
  .catch((error) => {
    console.log(error)
  })
})

// Gets all maps
app.get("/maps", (req, res) => {
  knex("maps")
    .then((results) => {
      res.json(results)
    })
    .catch(function(error) {
      console.log(error)
    })
})

// Gets all maps that a user has a relationship with (i.e. favourited, contributed)
app.get("/maps/:user_id", (req, res) => {
    knex("users_maps")
      .where({user_id: req.params.user_id})
      .then((results) => {
        res.json(results)
      })
      .catch(function(error) {
        console.log(error)
      })
})

// Get a map by its ID
app.get("/map/:map_id", (req, res) => {
  knex("maps")
    .where({id: req.params.map_id})
    .then((results) => {
      res.json(results)
    })
    .catch(function(error) {
      console.log(error)
    })
})

// Get all points associated with a map
app.get("/maps/:map_id/points", (req, res) => {
  knex("points")
    .where({map_id: req.params.map_id})
    .then((results) => {
      res.json(results)
    })
    .catch(function(error) {
      console.log(error)
    })
})

// Add a new point
app.post("/point", (req, res) => {
  knex("points")
    .insert (
    {
     title       : req.body.title,
     description : req.body.description,
     image       : req.body.image,
     latitude    : req.body.latitude,
     longitude   : req.body.longitude,
     map_id      : req.body.map_id,
     user_id     : req.body.user_id
    })
    .returning("id")
    .then((id) => {
      res.send(id)
    })
})

// Delete a point
app.delete("/point/:id", (req, res) => {
  knex("points")
    .where({
      id: req.params.id
    })
    .del()
    .then(() => {
    })
})

// Adds a new relationship between a user and map
app.post("/users_map", (req, res)=>{
  knex("users_maps")
    .insert(
    {
     user_id      : req.body.user_id,
     map_id       : req.body.map_id,
     favourite    : req.body.favourite,
     contribution : req.body.contribution
    })
    .then((results) => {
      renderHelper(req, res)
    })
})

// Adds a new map tp database
app.post("/map", (req, res) => {
  knex("maps")
    .insert (
    {
     creator_id : req.body.creator_id,
     title      : req.body.title,
     latitude   : req.body.latitude,
     longitude  : req.body.longitude
    })
    .returning("id")
    .then((results) => {
      renderHelper(req, res)
    })
})

// Upserts a point
app.put("/point/:point_id", (req, res) => {
    knex("points")
      .where({id: req.params.point_id})
      .update (
      {
       title       : req.body.title,
       description : req.body.description,
       image       : req.body.image,
       latitude    : req.body.latitude,
       longitude   : req.body.longitude,
       map_id      : req.body.map_id,
       user_id     : req.body.user_id
      })
      .returning("id")
      .then((id) => {
        res.send(id)
      })
})

// Configure the local strategy for use by Passport.
passport.use(new Strategy(
  (username, password, cb) => {
    db.findByUsername(username, (err, user) => {
      if (err) {
        return cb(err)
      }
      if (!user) {
        return cb(null, false, {
          message: "User does not exist."
        })
      }
      bcrypt.compare(password, user.password, (err, res) => {
        //res = true if password matches hash
        if(res){
          return cb(null, user)
        } else{
          return cb(null, false, {
            message: err
          })
        }
      })
    })
  }
))

// Configure Passport authenticated session persistence.
passport.serializeUser((user, cb) => {
  return cb(null, user.id)
})

passport.deserializeUser((id, cb) => {
  db.findById(id, (err, user) => {
    if (err) {
      return cb(err)
    }
    return cb(null, user)
 })
})

// Initialize Passport and restore authentication state, if any, from the session.
app.use(passport.initialize())
app.use(passport.session())

// Home page
app.get("/", (req, res) => {
  renderHelper(req, res)
})

// Login
app.post("/login",
  passport.authenticate("local", { successRedirect: "/",
    failureRedirect: "/"
  }))

// Register
app.post("/register",
  (req, res) => {
    knex("users")
    .count("name")
    .where("name", req.body.username)
    .then((results) => {
      if(results[0].count == 0){
        knex("users")
        .insert({
          name: req.body.username,
          email: req.body.email,
          password: bcrypt.hashSync(req.body.password, bcrypt.genSaltSync(10))
        })
        .returning("id")
        .then((results) => {
          // Attempt to login
          res.redirect(307, '/login')
        })
      }
    })
  })

// Logout
app.get("/logout",
  function(req, res){
    req.logout()
    res.redirect("/")
  })

// View profile
app.get("/profile",
  require("connect-ensure-login").ensureLoggedIn("/"),
  (req, res) => {
    res.render("profile", {
      user: req.user
    })
  })

app.listen(PORT, () => {
  console.log("Wikimaps listening on port " + PORT)
})
