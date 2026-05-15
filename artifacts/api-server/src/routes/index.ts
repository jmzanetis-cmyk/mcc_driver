import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import ridesRouter from "./rides";
import adminRouter from "./admin";
import rideAlongDriversRouter from "./rideAlongDrivers";
import stripeConnectRouter from "./stripeConnect";
import tandemJobsRouter from "./tandemJobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(ridesRouter);
router.use(adminRouter);
router.use(rideAlongDriversRouter);
router.use(stripeConnectRouter);
router.use(tandemJobsRouter);

export default router;
