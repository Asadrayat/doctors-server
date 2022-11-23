const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);


const port = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.nkyrz6w.mongodb.net/?retryWrites=true&w=majority`;

function verifyJWT(req, res, next) {

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })

}

// console.log(uri);
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
async function run() {
    try {
        const appointmentCollection = client.db('doctorsPortalBb').collection('appointmentOption');
        const bookingsCollection = client.db('doctorsPortalBb').collection('bookings');
        const userCollection = client.db('doctorsPortalBb').collection('users');
        const doctorsCollection = client.db('doctorsPortalBb').collection('doctors');
        const paymentsCollection = client.db('doctorsPortalBb').collection('payments');
        //NOTE: make sure you use it after verify jwt
        const verifyAdmin = async (req, res, next) => {
            console.log('inside verify admin', req.decoded.email);
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await userCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentCollection.find(query).toArray();
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray()
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatement == option.name)
                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
                console.log(date, remainingSlots.length);


            })
            res.send(options);
        })
        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);
        })
        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query);
            res.send(booking);
        })

        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatement: booking.treatement
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You have already booking on ${booking.appointmentDate}`;
                return res.send({ acknowledged: false, message })

            }
            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        });
        app.get('/appointmentSpeciality', async (req, res) => {
            const query = {};
            const result = await appointmentCollection.find(query).project({ name: 1 }).toArray();
            res.send(result);
        })
        app.post("/create-payment-intent", async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                currency: "usd",
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })
        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result);
        })
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.Access_Token, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            }
            res.status(403).send({ accessToken: '' })
        })
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await userCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await userCollection.find(query).toArray();
            res.send(users);
        });
        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await userCollection.insertOne(user);
            // console.log(result);
            res.send(result);
        })
        app.put('/users/admin/:id', verifyAdmin, verifyJWT, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        })
        // add temporary price to the api 
        // app.get('/addprice',async(req,res)=>{
        //     const filter = {};
        //     const options  = {upsert : true};
        //     const updatedDoc = {
        //         $set : {
        //             price : 99
        //         }
        //     }
        //     const result = await appointmentCollection.updateMany(filter,updatedDoc,options);
        //     res.send(result);
        // })
        app.get('/doctors', async (req, res) => {
            const query = req.body;
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        })
        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        })
        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })
    } finally {

    }
}
run().catch(console.log)



app.get('/', async (req, res) => {
    res.send('doctors portal server is running');
})
app.listen(port, () => console.log(`Doctor running on port${port}`))