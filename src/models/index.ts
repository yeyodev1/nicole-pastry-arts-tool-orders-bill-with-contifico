import { OrderModel } from "./order.model";
import { DailySummaryModel } from "./daily-summary.model";
import { UserModel } from "./user.model";
import { ParLevelModel } from "./par-level.model";
import { DeliveryPersonModel } from "./delivery-person.model";
import { ProviderModel } from "./provider.model";
import { RawMaterialModel } from "./raw-material.model";
import { POSStockObjectiveModel } from "./pos-stock-objective.model";
import { POSDailyEntryModel } from "./pos-daily-entry.model";
import { POSLossModel } from "./pos-loss.model";
import { SupplierOrderModel } from "./supplier-order.model";
import { GoalSettingsModel } from "./goal-settings.model";
import { ProductionSettingsModel } from "./production-settings.model";
import { ProviderCategoryModel } from "./provider-category.model";

export const models = {
  orders: OrderModel,
  dailySummaries: DailySummaryModel,
  users: UserModel,
  parLevels: ParLevelModel,
  deliveryPersons: DeliveryPersonModel,
  providers: ProviderModel,
  rawMaterials: RawMaterialModel,
  posStockObjectives: POSStockObjectiveModel,
  posDailyEntries: POSDailyEntryModel,
  posLosses: POSLossModel,
  supplierOrders: SupplierOrderModel,
  goalSettings: GoalSettingsModel,
  productionSettings: ProductionSettingsModel,
  providerCategories: ProviderCategoryModel,
};
