import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  farmer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  product_name: { type: String, required: true, trim: true, maxlength: 100 },
  category: { type: String, required: true, enum: ['Vegetables', 'Fruits', 'Grains', 'Dairy', 'Other'] },
  price: { type: Number, required: true, min: 0.01, max: 99999999.99 },
  quantity: { type: Number, required: true, min: 0, max: 9999999.999 },
  description: { type: String, default: '', maxlength: 2000 },
  farm_address: { type: String, default: '', trim: true, maxlength: 255 },
  image_url: { type: String, default: null, maxlength: 500 },
  is_active: { type: Boolean, default: true, index: true },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
});

productSchema.index({ category: 1, is_active: 1 });

export default mongoose.model('Product', productSchema);
