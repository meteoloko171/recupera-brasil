import { Router, type IRouter } from "express";
import healthRouter from "./health";
import consultaCpfRouter from "./consulta-cpf";
import pagamentoRouter from "./pagamento";
import adminRouter from "./admin";
import analyticsRouter from "./analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(consultaCpfRouter);
router.use(pagamentoRouter);
router.use(adminRouter);
router.use(analyticsRouter);

export default router;
