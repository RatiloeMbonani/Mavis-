const express = require('express')
const { connectDB } = require("./Config/config")
require("dotenv").config();

//routes 
const userRoutes = require('./Routes/userRoutes')
const interviewRoutes = require('./Routes/interviewRoutes')
 

//Models
const userModel = require('./Models/userModel')
const intervewModel = require('./Models/interviewModel')
const app = express()

const PORT = process.env.PORT || 5000;


app.use(express.json());       
app.use(express.urlencoded({ extended: true }));
app.use(userRoutes)
app.use(interviewRoutes)
app.use('/uploads', express.static('uploads'));

async function startServer() {
    await connectDB();
    

    app.listen(PORT, () => {
        console.log(`the server is running on port ${PORT}`)
    })
}
startServer();