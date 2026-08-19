import type { Response, NextFunction } from "express";
import { Branch } from "../models/branch.model";
import { AuthRequest } from "../types/AuthRequest";

export async function getBranches(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const branches = await Branch.find().sort({ sortOrder: 1, name: 1 });
    res.status(200).send({
      message: "Branches retrieved successfully.",
      data: branches,
    });
  } catch (error) {
    next(error);
  }
}

export async function createBranch(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { name, isActive, sortOrder } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).send({ message: "Branch name is required." });
      return;
    }

    const existing = await Branch.findOne({ name: name.trim() });
    if (existing) {
      res.status(409).send({ message: "A branch with this name already exists." });
      return;
    }

    const branch = await Branch.create({
      name: name.trim(),
      isActive: isActive !== false,
      sortOrder: sortOrder ?? 0,
    });

    res.status(201).send({
      message: "Branch created successfully.",
      data: branch,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateBranch(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { id } = req.params;
    const { name, isActive, sortOrder } = req.body;

    const branch = await Branch.findById(id);
    if (!branch) {
      res.status(404).send({ message: "Branch not found." });
      return;
    }

    if (name !== undefined) {
      if (!name.trim()) {
        res.status(400).send({ message: "Branch name cannot be empty." });
        return;
      }
      const duplicate = await Branch.findOne({ name: name.trim(), _id: { $ne: id } });
      if (duplicate) {
        res.status(409).send({ message: "A branch with this name already exists." });
        return;
      }
      branch.name = name.trim();
    }
    if (isActive !== undefined) branch.isActive = isActive;
    if (sortOrder !== undefined) branch.sortOrder = sortOrder;

    await branch.save();

    res.status(200).send({
      message: "Branch updated successfully.",
      data: branch,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteBranch(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { id } = req.params;
    const branch = await Branch.findByIdAndDelete(id);
    if (!branch) {
      res.status(404).send({ message: "Branch not found." });
      return;
    }
    res.status(200).send({ message: "Branch deleted successfully." });
  } catch (error) {
    next(error);
  }
}
