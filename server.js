const express = require('express')
const { connectDB } = require("./Config/config")
require("dotenv").config();

//routes 
const userRoutes = require('./Routes/userRoutes')

//Models
const userModel = require('./Models/userModel')
const app = express()

const PORT = process.env.PORT || 5000;

app.use(userRoutes)

async function startServer() {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`the server is running on port ${PORT}`)
    })
}
startServer();