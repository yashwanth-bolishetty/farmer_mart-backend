import { Router } from 'express';
import Product from '../models/Product.js';
import User from '../models/User.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { receiveProductImage, removeProductImage, saveProductImage } from '../middleware/productImageUpload.js';

const router = Router();
const validImageUrl = (value) => {
  if (!value) return true;
  if (/^\/uploads\/products\/[a-f\d-]+\.webp$/i.test(value)) return true;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const hasPrecision = (value, decimalPlaces) => {
  const factor = 10 ** decimalPlaces;
  return Math.abs(value * factor - Math.round(value * factor)) < 0.000001;
};
const isValidId = (value) => /^[a-f\d]{24}$/i.test(value);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const productResponse = (product) => ({
  product_id: product._id.toString(),
  farmer_id: product.farmer_id._id?.toString() || product.farmer_id.toString(),
  product_name: product.product_name,
  category: product.category,
  price: product.price,
  quantity: product.quantity,
  description: product.description,
  farm_address: product.farm_address || '',
  image_url: product.image_url,
  created_at: product.created_at,
  farmer_name: product.farmer_id.name || '',
});

router.get('/', asyncHandler(async (request, response) => {
  const { q = '', category, sort = 'newest' } = request.query;
  if (typeof q !== 'string' || q.length > 100) return response.status(400).json({ message: 'Search must be 100 characters or fewer.' });
  const sortOptions = {
    newest: { created_at: -1 },
    price_asc: { price: 1, product_name: 1 },
    price_desc: { price: -1, product_name: 1 },
    name_asc: { product_name: 1 },
  };
  if (!sortOptions[sort]) return response.status(400).json({ message: 'Choose a valid product sort order.' });
  if (category !== undefined && (typeof category !== 'string' || !['Vegetables', 'Fruits', 'Grains', 'Dairy', 'Other'].includes(category))) {
    return response.status(400).json({ message: 'Choose a valid product category.' });
  }

  const filter = { is_active: true, quantity: { $gt: 0 } };
  if (q.trim()) {
    const search = new RegExp(escapeRegex(q.trim()), 'i');
    const matchingFarmers = await User.find({ name: search }).distinct('_id');
    filter.$or = [
      { product_name: search },
      { description: search },
      { farmer_id: { $in: matchingFarmers } },
    ];
  }
  if (category && category !== 'All produce') filter.category = category;

  const products = await Product.find(filter).sort(sortOptions[sort]).populate('farmer_id', 'name');
  return response.json({ products: products.map(productResponse) });
}));

router.get('/mine', authenticate, requireRole('farmer'), asyncHandler(async (request, response) => {
  const products = await Product.find({
    farmer_id: request.user.user_id,
    is_active: true,
  }).sort({ created_at: -1 }).populate('farmer_id', 'name');
  return response.json({ products: products.map(productResponse) });
}));

router.post('/', authenticate, requireRole('farmer'), receiveProductImage.single('image'), asyncHandler(async (request, response) => {
  const { product_name, category, price, quantity, description = '', farm_address = '', image_url = '' } = request.body;
  const validCategories = ['Vegetables', 'Fruits', 'Grains', 'Dairy', 'Other'];
  if (typeof product_name !== 'string' || product_name.trim().length < 2 || product_name.trim().length > 100) {
    return response.status(400).json({ message: 'Product name must be between 2 and 100 characters.' });
  }
  if (!validCategories.includes(category)) return response.status(400).json({ message: 'Choose a valid product category.' });
  if (!Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) > 99999999.99 || !hasPrecision(Number(price), 2)) {
    return response.status(400).json({ message: 'Enter a price greater than zero with no more than 2 decimal places.' });
  }
  if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || Number(quantity) > 9999999.999 || !hasPrecision(Number(quantity), 3)) {
    return response.status(400).json({ message: 'Enter an available quantity greater than zero with no more than 3 decimal places.' });
  }
  if (typeof description !== 'string' || description.length > 2000) return response.status(400).json({ message: 'Description must be 2,000 characters or fewer.' });
  if (typeof farm_address !== 'string' || farm_address.length > 255) return response.status(400).json({ message: 'Farm address must be 255 characters or fewer.' });
  if (typeof image_url !== 'string' || image_url.length > 500 || !validImageUrl(image_url)) {
    return response.status(400).json({ message: 'Photo URL must be a valid HTTP or HTTPS address.' });
  }

  const uploadedImage = await saveProductImage(request.file);
  let product;
  try {
    product = await Product.create({
      farmer_id: request.user.user_id,
      product_name: product_name.trim(),
      category,
      price: Number(price),
      quantity: Number(quantity),
      description: description.trim(),
      farm_address: farm_address.trim(),
      image_url: uploadedImage || image_url || null,
    });
  } catch (error) {
    if (uploadedImage) {
      await removeProductImage(uploadedImage).catch((cleanupError) => {
        console.error('Could not clean up an unused product image.', cleanupError);
      });
    }
    throw error;
  }
  await product.populate('farmer_id', 'name');
  return response.status(201).json({ product: productResponse(product) });
}));

router.get('/:id', asyncHandler(async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(400).json({ message: 'Choose a valid product.' });
  const product = await Product.findOne({ _id: request.params.id, is_active: true }).populate('farmer_id', 'name');
  if (!product) return response.status(404).json({ message: 'This product is not available in the market.' });
  return response.json({ product: productResponse(product) });
}));

router.put('/:id', authenticate, requireRole('farmer'), receiveProductImage.single('image'), asyncHandler(async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(400).json({ message: 'Choose a valid product.' });
  const updates = {};
  const { product_name, category, price, quantity, description, farm_address, image_url } = request.body;
  if (product_name !== undefined) {
    if (typeof product_name !== 'string' || product_name.trim().length < 2 || product_name.trim().length > 100) return response.status(400).json({ message: 'Product name must be between 2 and 100 characters.' });
    updates.product_name = product_name.trim();
  }
  if (category !== undefined) {
    if (!['Vegetables', 'Fruits', 'Grains', 'Dairy', 'Other'].includes(category)) return response.status(400).json({ message: 'Choose a valid product category.' });
    updates.category = category;
  }
  if (price !== undefined) {
    if (!Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) > 99999999.99 || !hasPrecision(Number(price), 2)) return response.status(400).json({ message: 'Enter a price greater than zero with no more than 2 decimal places.' });
    updates.price = Number(price);
  }
  if (quantity !== undefined) {
    if (!Number.isFinite(Number(quantity)) || Number(quantity) < 0 || Number(quantity) > 9999999.999 || !hasPrecision(Number(quantity), 3)) return response.status(400).json({ message: 'Enter a valid available quantity with no more than 3 decimal places.' });
    updates.quantity = Number(quantity);
  }
  if (description !== undefined) {
    if (typeof description !== 'string' || description.length > 2000) return response.status(400).json({ message: 'Description must be 2,000 characters or fewer.' });
    updates.description = description.trim();
  }
  if (farm_address !== undefined) {
    if (typeof farm_address !== 'string' || farm_address.length > 255) return response.status(400).json({ message: 'Farm address must be 255 characters or fewer.' });
    updates.farm_address = farm_address.trim();
  }
  if (image_url !== undefined) {
    if (typeof image_url !== 'string' || image_url.length > 500 || !validImageUrl(image_url)) return response.status(400).json({ message: 'Photo URL must be a valid HTTP or HTTPS address.' });
    updates.image_url = image_url || null;
  }
  const uploadedImage = await saveProductImage(request.file);
  if (uploadedImage) updates.image_url = uploadedImage;
  if (!Object.keys(updates).length) return response.status(400).json({ message: 'Provide at least one product detail to update.' });

  const productFilter = {
    _id: request.params.id,
    farmer_id: request.user.user_id,
    is_active: true,
  };
  let previousProduct;
  try {
    previousProduct = await Product.findOneAndUpdate(
      productFilter,
      { $set: updates },
      { new: false, runValidators: true },
    );
  } catch (error) {
    if (uploadedImage) {
      await removeProductImage(uploadedImage).catch((cleanupError) => {
        console.error('Could not clean up an unused product image.', cleanupError);
      });
    }
    throw error;
  }
  if (!previousProduct) {
    if (uploadedImage) {
      await removeProductImage(uploadedImage).catch((cleanupError) => {
        console.error('Could not clean up an unused product image.', cleanupError);
      });
    }
    return response.status(404).json({ message: 'This listing could not be found in your farm.' });
  }
  const product = await Product.findById(request.params.id).populate('farmer_id', 'name');
  if (previousProduct.image_url !== product.image_url) {
    await removeProductImage(previousProduct.image_url).catch((error) => {
      console.error('Could not remove the replaced product image.', error);
    });
  }
    return response.json({ product: productResponse(product) });
}));

router.delete('/:id', authenticate, requireRole('farmer'), asyncHandler(async (request, response) => {
  if (!isValidId(request.params.id)) return response.status(400).json({ message: 'Choose a valid product.' });
  const product = await Product.findOneAndUpdate({
    _id: request.params.id,
    farmer_id: request.user.user_id,
    is_active: true,
  }, { $set: { is_active: false } });
  if (!product) return response.status(404).json({ message: 'This listing could not be found in your farm.' });
  return response.json({ message: 'Product listing removed.' });
}));

export default router;
