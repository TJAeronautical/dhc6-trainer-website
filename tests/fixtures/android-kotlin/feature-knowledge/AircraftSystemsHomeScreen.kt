package com.dhc6trainer.feature.knowledge.ui.screens

// Reduced fixture mirroring the structure of AircraftSystemsHomeScreen.kt (test
// data only, invented strings). The build reads: the `systems` tile order,
// AircraftSystem.shortHint(), AircraftSystem.tileImageResId() and
// systemHomeReferenceImageCount().

@Composable
fun AircraftSystemsHomeScreen(
    aircraftVariant: AircraftVariant,
    onOpenSystem: (AircraftSystem) -> Unit
) {
    val systems = remember {
        listOf(
            AircraftSystem.ATA_100,
            AircraftSystem.FUEL,
            AircraftSystem.POWERPLANT,
            AircraftSystem.ELECTRICAL,
            AircraftSystem.LIMITATIONS,
            AircraftSystem.ICE_RAIN_PROTECTION,
            AircraftSystem.GENERAL
        )
    }
    systems.forEach { system -> AircraftSystemTile(system = system, onClick = { onOpenSystem(system) }) }
}

private fun AircraftSystem.tileImageResId(): Int = when (this) {
    AircraftSystem.POWERPLANT,
    AircraftSystem.FUEL,
    AircraftSystem.ICE_RAIN_PROTECTION -> CoreRes.drawable.dhc6_tile_engine_cutaway
    AircraftSystem.LIMITATIONS -> CoreRes.drawable.procedure_tile_takeoff
    AircraftSystem.ELECTRICAL -> CoreRes.drawable.dhc6_tile_cockpit_panel
    AircraftSystem.ATA_100,
    AircraftSystem.GENERAL -> CoreRes.drawable.dhc6_tile_runway_overview
}

private fun AircraftSystem.shortHint(): String = when (this) {
    AircraftSystem.GENERAL -> "Fixture hint: general."
    AircraftSystem.ATA_100 -> "Fixture hint: manual structure."
    AircraftSystem.LIMITATIONS -> "Fixture hint: limitations."
    AircraftSystem.POWERPLANT -> "Fixture hint: powerplant."
    AircraftSystem.FUEL -> "Fixture hint: fuel."
    AircraftSystem.ELECTRICAL -> "Fixture hint: electrical."
    AircraftSystem.ICE_RAIN_PROTECTION -> "Fixture hint: ice and rain."
}

private fun systemHomeReferenceImageCount(system: AircraftSystem): Int = when (system) {
    AircraftSystem.ATA_100 -> 1
    AircraftSystem.FUEL -> 4
    AircraftSystem.POWERPLANT -> 5
    AircraftSystem.ELECTRICAL -> 1
    AircraftSystem.LIMITATIONS -> 4
    else -> 0
}
