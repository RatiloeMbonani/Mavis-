const express = require('express')
const { connectDB } = require("./Config/config")
require("dotenv").config();
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const cors =require('cors')
//routes 
const userRoutes = require('./Routes/userRoutes')
const interviewRoutes = require('./Routes/interviewRoutes')

//Models
const userModel = require('./Models/userModel')
const interviewModel = require('./Models/interviewModel')

//services
const { startMavisSession } = require('./services/geminiRelay')

const app = express()

const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(userRoutes)
app.use(interviewRoutes)
// app.use('/uploads', express.static('uploads'));  <-- removed, CVs now live in Azure Blob

async function startServer() {
    await connectDB();

    const server = app.listen(PORT, () => {
        console.log(`the server is running on port ${PORT}`)
    })

    const wss = new WebSocketServer({ server, path: '/ws/interview' });

    wss.on('connection', async (clientSocket, req) => {
        console.log('New WebSocket client connecting...');

        try {
            // Expecting: ws://host/ws/interview?token=xxx&interviewId=xxx
            const url = new URL(req.url, `http://${req.headers.host}`);
            const token = url.searchParams.get('token');
            const interviewId = url.searchParams.get('interviewId');

            if (!token || !interviewId) {
                clientSocket.close(4001, 'Missing token or interviewId');
                return;
            }

            let decoded;
            try {
                decoded = jwt.verify(token, process.env.JWT_SECRET);
            } catch (err) {
                clientSocket.close(4001, 'Invalid or expired token');
                return;
            }

            const interview = await interviewModel.findById(interviewId);
            if (!interview) {
                clientSocket.close(4004, 'Interview not found');
                return;
            }

            const user = await userModel.findById(decoded.user_id).select('cvText');
            console.log(`Authorized: user ${decoded.user_id}, interview ${interviewId}`);

            const context = {
                jobTitle: interview.jobTitle,
                jobDescription: interview.jobDescription,
                cvText: user?.cvText || '', 
            };

            startMavisSession(clientSocket, context, async (transcript) => {
                console.log('Saving final transcript for interview', interviewId);
                await interviewModel.findByIdAndUpdate(interviewId, {
                    transcript,
                    status: 'completed',
                    endedAt: new Date(),
                });
            });

        } catch (err) {
            console.error('WebSocket connection setup failed:', err);
            clientSocket.close(1011, 'Internal error');
        }
    });
}
startServer();