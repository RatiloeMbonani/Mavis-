const { BlobServiceClient } = require('@azure/storage-blob');

const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);

const containerClient = blobServiceClient.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER_NAME
);

async function uploadToBlob(fileBuffer, originalName, userId) {
  await containerClient.createIfNotExists();

  const blobName = `${userId}-${Date.now()}${require('path').extname(originalName)}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(fileBuffer, {
    blobHTTPHeaders: { blobContentType: 'application/pdf' },
  });

  return blockBlobClient.url; // this becomes your cvUrl
}

module.exports = { uploadToBlob };