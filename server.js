// Paste ALL code below this line
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const sgMail = require('@sendgrid/mail');
const app = express();

// ======= CONFIGURATION ======= //
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const upload = multer({ dest: 'uploads/' });

// ======= DATABASE SCHEMA ======= //
const DealSchema = new mongoose.Schema({
  recordId: { type: String, unique: true },
  dealName: String,
  dealOwner: String,
  secondOwner: String,
  lastActivityDate: Date,
  dealStage: String,
  lastReminderSent: Date // Track when last reminder was sent
});
const Deal = mongoose.model('Deal', DealSchema);

// ======= ROUTES ======= //
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('csvFile'), async (req, res) => {
  if (!req.file || !req.body.daysThreshold) {
    return res.status(400).send('Missing file or days threshold');
  }

  const daysThreshold = parseInt(req.body.daysThreshold);
  const results = [];
  
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => {
      results.push({
        recordId: data['Record ID'],
        dealName: data['Deal Name'],
        dealOwner: data['Deal owner'],
        secondOwner: data['Second Owner'],
        lastActivityDate: data['Last Activity Date'] ? 
          new Date(data['Last Activity Date'].replace(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})/, '$3-$2-$1 $4')) : null,
        dealStage: data['Deal Stage'],
      });
    })
    .on('end', async () => {
      try {
        // Update existing deals or create new ones
        for (const deal of results) {
          await Deal.findOneAndUpdate(
            { recordId: deal.recordId },
            { ...deal, lastReminderSent: null },
            { upsert: true, new: true }
          );
        }
        fs.unlinkSync(req.file.path);
        res.send(`CSV processed! Reminders set for >${daysThreshold} days inactivity`);
      } catch (err) {
        res.status(500).send('Error processing CSV');
      }
    });
});

// ======= EMAIL LOGIC ======= //
const ownerEmails = {
  'Farooq Aziz': 'farooq@xstak.com',
  'Omer Zia': 'omer.zia@xstak.com',
  'Bairum khan': 'bairum.khan@xstak.com',
  'Shumaila Rafique': 'shumaila.rafique@xstak.com',
  'Ammar Yasir': 'ammar.yasir@postex.pk',
  'arslan.tariq@postex.pk': 'arslan.tariq@postex.pk',
  'rakhshan.shaheer@postex.pk': 'rakhshan.shaheer@postex.pk',
  'raafay.qureshi@postex.pk': 'raafay.qureshi@postex.pk',
};
const ccEmails = ['noshairwan.khan@postex.pk', 'farooq@xstak.com'];

async function sendReminderEmails() {
  const deals = await Deal.find();
  const threshold = 10; // Default threshold
  
  for (const deal of deals) {
    if (!deal.lastActivityDate) continue;
    
    const daysInactive = Math.floor((new Date() - deal.lastActivityDate) / (1000 * 60 * 60 * 24));
    const recipient = deal.secondOwner && ownerEmails[deal.secondOwner] ? deal.secondOwner : deal.dealOwner;
    const email = ownerEmails[recipient];
    
    if (daysInactive > threshold) {
      // Track unresolved deals logic
      let unresolvedText = "";
      if (deal.lastReminderSent) {
        const daysSinceLastReminder = Math.floor((new Date() - deal.lastReminderSent) / (1000 * 60 * 60 * 24));
        if (daysSinceLastReminder === 1) {
          unresolvedText = `\n\nUNRESOLVED: This deal was mentioned yesterday but has no new activity!`;
        }
      }

      const msg = {
        to: email,
        cc: ccEmails,
        from: process.env.SENDER_EMAIL,
        subject: `URGENT: Follow up on ${deal.dealName}`,
        text: `Deal: ${deal.dealName}\nInactive: ${daysInactive} days${unresolvedText}\n\nLast Activity: ${deal.lastActivityDate.toDateString()}`,
      };
      
      try {
        await sgMail.send(msg);
        // Update reminder timestamp
        deal.lastReminderSent = new Date();
        await deal.save();
      } catch (err) {
        console.error(`Email failed for ${deal.dealName}:`, err);
      }
    }
  }
}

// ======= START SERVER ======= //
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(process.env.PORT || 3000, () => console.log('Server running'));
    cron.schedule('0 9 * * *', sendReminderEmails); // Daily at 9 AM
  })
  .catch(err => console.error('MongoDB connection failed:', err));