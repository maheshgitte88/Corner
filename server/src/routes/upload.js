import { Router } from "express";
import multer from "multer";
import { storeProductImage } from "../storage/providers.js";
const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
router.post(
  "/upload/product-image",
  upload.single("image"),
  async (req, res) => {
    res.json(await storeProductImage(req.file, req.tenant.id));
  },
);
export default router;
