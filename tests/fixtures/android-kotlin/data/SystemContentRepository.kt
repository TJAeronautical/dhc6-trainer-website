package com.dhc6trainer.data.content.systems

// Reduced fixture mirroring the structure of SystemContentRepository.kt. The
// build reads SYSTEM_TO_ASSET_BASENAME.

class BundledSystemContentRepository(context: Context) : SystemContentRepository {
    companion object {
        val SYSTEM_TO_ASSET_BASENAME: Map<AircraftSystem, String> = mapOf(
            AircraftSystem.GENERAL to "general",
            AircraftSystem.AIRCRAFT_GENERAL to "general",
            AircraftSystem.ELECTRICAL to "electrical",
            AircraftSystem.FUEL to "fuel",
            AircraftSystem.POWERPLANT to "powerplant",
            AircraftSystem.ENGINE to "powerplant"
        )
    }
}
