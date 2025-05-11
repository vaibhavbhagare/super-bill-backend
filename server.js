const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const cors = require('cors'); // Import cors middleware
const userRoutes = require('./routes/userRoutes');
const customerRoutes = require('./routes/customerRoutes');

dotenv.config();

const app = express();

// Enable CORS and allow requests from http://localhost:8081
app.use(cors({
  origin: 'http://localhost:8081', // Allow only this origin
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed HTTP methods
  allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
}));

app.use(bodyParser.json());
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('MongoDB connected');
  app.listen(process.env.PORT || 8080, () => {
    console.log(`Server running on port ${process.env.PORT || 8080}`);
  });
})
.catch(err => console.log(err));