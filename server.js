require("dotenv").config();
const express = require('express')
const path = require('path')
const { connectDB } = require("./Config/config")
const cors =require('cors')
//routes 
const userRoutes = require('./Routes/userRoutes')
const interviewRoutes = require('./Routes/interviewRoutes')
const chatBotRoutes = require('./Routes/chaBotRoutes')
const documentRoutes = require('./Routes/documentRoutes');
const app = express()

const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(userRoutes)
app.use(interviewRoutes)
app.use(chatBotRoutes)
app.use(documentRoutes)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/profile-avatars', express.static(path.join(__dirname, 'uploads', 'profile-avatars')));

async function startServer() {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`the server is running on port ${PORT}`)
    })
}
startServer();
