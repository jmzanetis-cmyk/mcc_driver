import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import ridesRouter from "./rides";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(ridesRouter);
router.use(adminRouter);

export default router;
