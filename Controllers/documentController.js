// documentController.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const User = require("../Models/userModel");

const UPLOADS_DIR = path.join(__dirname, "..", "uploads");

async function extractTextFromBuffer(buffer, mimetype) {
  try {
    if (mimetype === "application/pdf") {
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer);
      return data.text;
    }
    return null;
  } catch (err) {
    console.error("Failed to extract text from document:", err);
    return null;
  }
}

const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { documentType } = req.body;
    if (!["cv", "cover_letter"].includes(documentType)) {
      return res.status(400).json({ error: "Invalid documentType" });
    }

    // Generate a unique filename so uploads never collide
    const uniqueName = `${req.user.user_id}-${documentType}-${crypto.randomUUID()}.pdf`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);

    fs.writeFileSync(filePath, req.file.buffer);

    const extractedText = await extractTextFromBuffer(req.file.buffer, req.file.mimetype);
    const fileUrl = `/uploads/${uniqueName}`;

    const updateFields =
      documentType === "cv"
        ? { cvUrl: fileUrl, cvFileName: req.file.originalname, cvText: extractedText }
        : {
            coverLetterUrl: fileUrl,
            coverLetterFileName: req.file.originalname,
            coverLetterText: extractedText,
          };

    await User.findByIdAndUpdate(req.user.user_id, updateFields);

    res.status(201).json({
      id: documentType,
      name: req.file.originalname,
      type: documentType,
      url: fileUrl,
    });
  } catch (err) {
    console.error("Failed to upload document:", err);
    res.status(500).json({ error: err.message });
  }
};

const deleteDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    if (!["cv", "cover_letter"].includes(documentId)) {
      return res.status(400).json({ error: "Invalid documentId" });
    }

    const user = await User.findById(req.user.user_id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const oldUrl = documentId === "cv" ? user.cvUrl : user.coverLetterUrl;

    const clearFields =
      documentId === "cv"
        ? { cvUrl: null, cvFileName: null, cvText: null }
        : { coverLetterUrl: null, coverLetterFileName: null, coverLetterText: null };

    await User.findByIdAndUpdate(req.user.user_id, clearFields);

    if (oldUrl) {
      const filePath = path.join(__dirname, "..", oldUrl);
      fs.unlink(filePath, (err) => {
        if (err) console.error("Failed to delete file from disk:", err);
      });
    }

    res.json({ message: "Document deleted successfully" });
  } catch (err) {
    console.error("Failed to delete document:", err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { uploadDocument, deleteDocument };