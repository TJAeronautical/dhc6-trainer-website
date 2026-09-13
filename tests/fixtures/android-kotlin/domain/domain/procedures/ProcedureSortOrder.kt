package fixture

object ProcedureSortOrder {
    private val excelSequenceByCategory: Map<ProcedureCategory, Map<String, Int>> = mapOf(
        ProcedureCategory.NORMAL to listOf(
            "Test Normal [Ground]"
        ).mapIndexed { index, title -> normalizeTitle(title) to index }.toMap(),
        ProcedureCategory.ABNORMAL to listOf(
            "Zulu Abnormal [Airborne]",
            "Test Abnormal [Airborne]"
        ).mapIndexed { index, title -> normalizeTitle(title) to index }.toMap(),
        ProcedureCategory.EMERGENCY to listOf(
            "Test Emergency [Ground/Airborne]"
        ).mapIndexed { index, title -> normalizeTitle(title) to index }.toMap()
    )
}
