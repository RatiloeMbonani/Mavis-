const express = require('express')
const { connectDB } = require("./Config/config")
require("dotenv").config();

//routes 
const userRoutes = require('./Routes/userRoutes')

//Models
const userModel = require('./Models/userModel')
const app = express()

const PORT = process.env.PORT || 5000;

const data ={
    status: "healthy"
}

app.get('/', (req,res)=>{
    res.status(200).send(data)
})

app.use(express.json());       
app.use(express.urlencoded({ extended: true }));
app.use(userRoutes)

async function startServer() {
    await connectDB();
    

    app.listen(PORT, () => {
        console.log(`the server is running on port ${PORT}`)
    })
}
startServer();