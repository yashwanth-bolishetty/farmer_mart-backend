import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  farmer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product_name: { type: String, required: true },
  farmer_name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0.001 },
  price_at_purchase: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
});

const orderSchema = new mongoose.Schema({
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  customer_name: { type: String, required: true },
  order_date: { type: Date, default: Date.now, index: true },
  total_amount: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
  address: {
    address_line: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
  },
  items: { type: [orderItemSchema], required: true, validate: (items) => items.length > 0 },
}, { versionKey: false });

orderSchema.index({ customer_id: 1, order_date: -1 });
orderSchema.index({ 'items.farmer_id': 1, order_date: -1 });

export default mongoose.model('Order', orderSchema);
