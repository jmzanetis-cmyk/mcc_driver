import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import ridesRouter from "./rides";
import adminRouter from "./admin";
import rideAlongDriversRouter from "./rideAlongDrivers";
import stripeConnectRouter from "./stripeConnect";
import tandemJobsRouter from "./tandemJobs";
import tandemMatchingRouter from "./tandemMatching";
import payoutsRouter from "./payouts";
import deviceTokensRouter from "./deviceTokens";
import devPushTestRouter from "./devPushTest";
import driverLocationRouter from "./driverLocation";
import driverAccountRouter from "./driverAccount";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(ridesRouter);
router.use(adminRouter);
router.use(rideAlongDriversRouter);
router.use(stripeConnectRouter);
router.use(tandemJobsRouter);
router.use(tandemMatchingRouter);
router.use(payoutsRouter);
router.use(deviceTokensRouter);
router.use(devPushTestRouter);
router.use(driverLocationRouter);
router.use(driverAccountRouter);

export default router;
