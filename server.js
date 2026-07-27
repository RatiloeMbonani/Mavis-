const express = require('express')
const { connectDB } = require("./Config/config")
require("dotenv").config();

const app = express()

const PORT = process.env.PORT || 5000;
const data = {
    status: "running"
};

app.get('/', (req, res) => {
    res.status(200).json(data)
})

async function startServer() {
    await connectDB();

    app.listen(PORT, () => {
        console.log(`the server is running on port ${PORT}`)
    })
}
startServer();