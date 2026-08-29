package com.lingzhen.center.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

class LayerDependencyTest {

    private static final JavaClasses APPLICATION_CLASSES = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.lingzhen.center");

    @Test
    void controllerLayerMustNotDependOnDataLayerOrBusinessImplementations() {
        noClasses()
                .that().resideInAPackage("..controller..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "..repository..",
                        "..model.entity..",
                        "..service.impl.."
                )
                .check(APPLICATION_CLASSES);
    }

    @Test
    void onlyDataLayerAndBusinessImplementationsMayDependOnRepositories() {
        noClasses()
                .that().resideOutsideOfPackages("..repository..", "..service.impl..")
                .should().dependOnClassesThat().resideInAPackage("..repository..")
                .check(APPLICATION_CLASSES);
    }

    @Test
    void dataLayerMustNotDependOnControllerOrBusinessLayers() {
        noClasses()
                .that().resideInAPackage("..repository..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "..controller..",
                        "..service..",
                        "..security.."
                )
                .check(APPLICATION_CLASSES);
    }

    @Test
    void modelLayerMustRemainIndependentFromApplicationLayers() {
        noClasses()
                .that().resideInAPackage("..model..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "..controller..",
                        "..service..",
                        "..repository..",
                        "..security..",
                        "..config.."
                )
                .check(APPLICATION_CLASSES);
    }
}
