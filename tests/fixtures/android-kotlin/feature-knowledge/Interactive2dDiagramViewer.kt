package com.dhc6trainer.feature.knowledge.ui.screens

// Reduced fixture mirroring the structure of Interactive2dDiagramViewer.kt (test
// data only, invented strings). The build reads diagramPinsForSystem().

internal data class DiagramPin(
    val id: String,
    val label: String,
    val normalizedX: Float,
    val normalizedY: Float,
    val keyFact: String,
    val consequence: String,
    val studyPrompt: String
)

internal fun diagramPinsForSystem(system: AircraftSystem): List<DiagramPin> = when (system) {

    // -- POWERPLANT --
    AircraftSystem.POWERPLANT -> listOf(
        DiagramPin("inlet", "Air inlet (Station 1)", 0.82f, 0.56f, "Fixture key fact, with a comma.", "Fixture consequence.", "Fixture study prompt?"),
        DiagramPin("rgb", "Reduction gearbox", 0.18f, 0.48f, "Fixture key fact two.", "Fixture consequence two.", "Fixture study prompt two?")
    )

    // -- FUEL --
    AircraftSystem.FUEL -> listOf(
        DiagramPin("aft_tank", "AFT fuel tank", 0.15f, 0.45f, "Fixture fuel fact.", "Fixture fuel consequence.", "Fixture fuel prompt?")
    )

    // -- ICE / RAIN: pins authored, but no reference image exists --
    AircraftSystem.ICE_RAIN_PROTECTION -> listOf(
        DiagramPin("boots", "De-ice boots", 0.5f, 0.5f, "Fixture boots fact.", "Fixture boots consequence.", "Fixture boots prompt?")
    )

    else -> emptyList()
}
