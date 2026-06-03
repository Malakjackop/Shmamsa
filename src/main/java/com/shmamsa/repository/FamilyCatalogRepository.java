package com.shmamsa.repository;

import com.shmamsa.model.FamilyCatalog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface FamilyCatalogRepository extends JpaRepository<FamilyCatalog, Long> {
    Optional<FamilyCatalog> findByCode(String code);
    Optional<FamilyCatalog> findByNameAr(String nameAr);
    List<FamilyCatalog> findByActiveTrueAndBaseName(String baseName);
    List<FamilyCatalog> findByActiveTrueAndServantSelectableTrueOrderBySortOrderAscNameArAsc();
    List<FamilyCatalog> findByActiveTrueAndMemberSelectableTrueOrderBySortOrderAscNameArAsc();
    List<FamilyCatalog> findByActiveTrueAndCategoryOrderBySortOrderAscNameArAsc(String category);
    List<FamilyCatalog> findByActiveTrueAndKhorsSelectableTrueOrderBySortOrderAscNameArAsc();
    List<FamilyCatalog> findByActiveTrueAndAttendKhorsSelectableTrueOrderBySortOrderAscNameArAsc();
    boolean existsByNameArAndActiveTrueAndServantSelectableTrue(String nameAr);
    boolean existsByNameArAndActiveTrueAndMemberSelectableTrue(String nameAr);
    List<FamilyCatalog> findAllByOrderBySortOrderAsc();
}
