import { Router } from 'express';
import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

const orderStatus = (items) => {
  const statuses = items.map((item) => item.status);
  if (statuses.every((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.includes('preparing')) return 'preparing';
  if (statuses.includes('confirmed')) return 'confirmed';
  if (statuses.includes('shipped')) return 'shipped';
  return 'delivered';
};

const orderResponse = (order, farmerId) => {
  const items = farmerId
    ? order.items.filter((item) => item.farmer_id.toString() === farmerId)
    : order.items;
  return {
    order_id: order._id.toString(),
    order_date: order.order_date,
    total_amount: order.total_amount,
    status: farmerId ? orderStatus(items) : order.status,
    address_line: order.address.address_line,
    city: order.address.city,
    state: order.address.state,
    pincode: order.address.pincode,
    ...(farmerId ? { customer_name: order.customer_name } : {}),
    items: items.map((item) => ({
      order_item_id: item._id.toString(),
      product_id: item.product_id.toString(),
      product_name: item.product_name,
      farmer_name: item.farmer_name,
      quantity: item.quantity,
      price_at_purchase: item.price_at_purchase,
      status: item.status,
    })),
  };
};

const validId = (value) => /^[a-f\d]{24}$/i.test(value);
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

router.get('/mine', authenticate, requireRole('customer'), asyncHandler(async (request, response) => {
  const orders = await Order.find({ customer_id: request.user.user_id }).sort({ order_date: -1 });
  return response.json({ orders: orders.map((order) => orderResponse(order)) });
}));

router.get('/farmer', authenticate, requireRole('farmer'), asyncHandler(async (request, response) => {
  const orders = await Order.find({ 'items.farmer_id': request.user.user_id }).sort({ order_date: -1 });
  return response.json({
    orders: orders.map((order) => orderResponse(order, request.user.user_id)),
  });
}));

router.post('/', authenticate, requireRole('customer'), asyncHandler(async (request, response) => {
  const { items, address } = request.body;
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    return response.status(400).json({ message: 'Add between 1 and 30 products to your basket.' });
  }
  const productIds = new Set();
  for (const item of items) {
    const quantity = Number(item?.quantity);
    const productId = item?.product_id;
    if (typeof productId !== 'string' || !validId(productId) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999.999 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001) {
      return response.status(400).json({ message: 'Every product needs a valid ID and a quantity greater than zero (up to 3 decimal places).' });
    }
    if (productIds.has(productId)) return response.status(400).json({ message: 'Each product should appear only once in your basket.' });
    productIds.add(productId);
  }
  if (!address || typeof address.address_line !== 'string' || !address.address_line.trim() || address.address_line.length > 255
      || typeof address.city !== 'string' || !address.city.trim() || address.city.length > 100
      || typeof address.state !== 'string' || !address.state.trim() || address.state.length > 100
      || typeof address.pincode !== 'string' || !/^[0-9]{4,10}$/.test(address.pincode)) {
    return response.status(400).json({ message: 'Enter a complete delivery address and a valid PIN code.' });
  }

  const session = await mongoose.startSession();
  let createdOrder;
  try {
    await session.withTransaction(async () => {
      const sortedItems = [...items].sort((left, right) => left.product_id.localeCompare(right.product_id));
      const products = await Product.find({
        _id: { $in: sortedItems.map((item) => item.product_id) },
        is_active: true,
      }).session(session);
      const productById = new Map(products.map((product) => [product._id.toString(), product]));
      const orderLines = [];
      let totalCents = 0;

      for (const item of sortedItems) {
        const product = productById.get(item.product_id);
        if (!product) throw fail('One of the products in your basket is no longer available.', 409);
        const quantity = Number(item.quantity);
        if (product.quantity < quantity) throw fail(`${product.product_name} does not have enough stock for that quantity.`, 409);
        totalCents += Math.round(product.price * quantity * 100);
        if (!Number.isSafeInteger(totalCents) || totalCents > 9999999999) {
          throw fail('The basket total is above the maximum supported order amount.', 400);
        }
        orderLines.push({ product, quantity });
      }

      const farmerIds = [...new Set(orderLines.map(({ product }) => product.farmer_id.toString()))];
      const farmers = await User.find({ _id: { $in: farmerIds } }).select('name').session(session);
      const farmerById = new Map(farmers.map((farmer) => [farmer._id.toString(), farmer.name]));

      for (const { product, quantity } of orderLines) {
        const updatedProduct = await Product.findOneAndUpdate({
          _id: product._id,
          is_active: true,
          quantity: { $gte: quantity },
        }, { $inc: { quantity: -quantity } }, { new: true, session });
        if (!updatedProduct) throw fail(`${product.product_name} has just sold out. Please refresh your basket.`, 409);
      }

      const order = new Order({
        customer_id: request.user.user_id,
        customer_name: request.user.name,
        total_amount: totalCents / 100,
        status: 'pending',
        address: {
          address_line: address.address_line.trim(),
          city: address.city.trim(),
          state: address.state.trim(),
          pincode: address.pincode,
        },
        items: orderLines.map(({ product, quantity }) => ({
          product_id: product._id,
          farmer_id: product.farmer_id,
          product_name: product.product_name,
          farmer_name: farmerById.get(product.farmer_id.toString()) || '',
          quantity,
          price_at_purchase: product.price,
          status: 'pending',
        })),
      });
      await order.save({ session });
      createdOrder = order;
    });
  } finally {
    await session.endSession();
  }

  return response.status(201).json({
    order: {
      order_id: createdOrder._id.toString(),
      total_amount: createdOrder.total_amount.toFixed(2),
      status: createdOrder.status,
    },
  });
}));

const transitions = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

router.patch('/:id/status', authenticate, requireRole('farmer'), asyncHandler(async (request, response) => {
  const { id } = request.params;
  const { status } = request.body;
  if (!validId(id)) return response.status(400).json({ message: 'Choose a valid order.' });
  if (!Object.hasOwn(transitions, status) || status === 'pending') {
    return response.status(400).json({ message: 'Choose a valid next order status.' });
  }

  const session = await mongoose.startSession();
  let updatedStatus;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);
      if (!order) throw fail('This order could not be found for your farm.', 404);
      const farmerItems = order.items.filter((item) => item.farmer_id.toString() === request.user.user_id);
      if (!farmerItems.length) throw fail('This order could not be found for your farm.', 404);
      const invalidTransition = farmerItems.find((item) => !transitions[item.status]?.includes(status));
      if (invalidTransition) throw fail(`An order item cannot move from ${invalidTransition.status} to ${status}.`, 409);

      for (const item of farmerItems) {
        item.status = status;
        if (status === 'cancelled') {
          const result = await Product.updateOne(
            { _id: item.product_id },
            { $inc: { quantity: item.quantity } },
            { session },
          );
          if (!result.matchedCount) throw fail('A product in this order could not be found.', 409);
        }
      }
      order.status = orderStatus(order.items);
      await order.save({ session });
      updatedStatus = order.status;
    });
  } finally {
    await session.endSession();
  }
  return response.json({ order_id: id, status: updatedStatus });
}));

export default router;
