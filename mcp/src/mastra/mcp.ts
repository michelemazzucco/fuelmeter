import { MCPServer } from "@mastra/mcp"
import { getConsumptionStats, getDailyLevels, getSeasonalWeights, listConsumptionCycles } from "./tools/consumption"
import { getBoilerHours, getBoilerModel } from "./tools/heating"
import { convertCmToLiters, getForecast, getTankStatus, listReadings } from "./tools/tank"

export const fuelmeterServer = new MCPServer({
  id: "fuelmeter",
  name: "FuelMeter",
  version: "0.1.0",
  // claude.ai connectors still speak the 2025 revision, which 2.x rejects by default
  legacy: "stateless",
  description: "Read-only access to a home heating-oil tank: readings, forecast, consumption and boiler hours.",
  instructions:
    "Data about one house's heating-oil (diesel) tank, read with a dip-stick, and its oil boiler's on-hours from a Netatmo thermostat. All volumes are litres, rates are L/day, boiler time is hours, dates are yyyy-MM-dd. Start with get_tank_status or get_forecast; use the other tools for detail. For heating or insulation questions, get_boiler_model gives litres per boiler hour and the base burn without heating, and get_boiler_hours / list_consumption_cycles give the history to compare periods.",
  tools: {
    get_tank_status: getTankStatus,
    get_forecast: getForecast,
    list_readings: listReadings,
    get_daily_levels: getDailyLevels,
    get_consumption_stats: getConsumptionStats,
    list_consumption_cycles: listConsumptionCycles,
    get_seasonal_weights: getSeasonalWeights,
    get_boiler_hours: getBoilerHours,
    get_boiler_model: getBoilerModel,
    convert_cm_to_liters: convertCmToLiters,
  },
})
