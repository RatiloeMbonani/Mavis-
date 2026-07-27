const express = require('express')

const app = express()

const PORT = 3000;
const data={
    status: "running"
};

app.get('/', (req,res)=>{
    res.status(200).json(data)
})

app.listen(PORT, ()=>{
    console.log(`the server is running on port ${PORT}`)
})
