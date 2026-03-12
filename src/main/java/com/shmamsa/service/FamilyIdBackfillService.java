package com.shmamsa.service;

import com.shmamsa.model.FamilyCatalog;
import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class FamilyIdBackfillService {

    private final UserRepository userRepository;
    private final FamilyCatalogService familyCatalogService;

    @PostConstruct
    @Transactional
    public void backfill() {
        for (User user : userRepository.findAll()) {
            boolean changed = false;
            changed |= fillPrimary(user);
            changed |= fillSecondary(user);
            changed |= fillThird(user);
            changed |= fillFourth(user);
            if (changed) {
                userRepository.save(user);
            }
        }
    }

    private boolean fillPrimary(User user) {
        if (user.getDeaconFamilyId() != null) return false;
        FamilyCatalog family = familyCatalogService.findByName(user.getDeaconFamily());
        if (family == null || family.getId() == null) return false;
        user.setDeaconFamilyId(family.getId());
        return true;
    }

    private boolean fillSecondary(User user) {
        if (user.getDeaconFamily2Id() != null) return false;
        FamilyCatalog family = familyCatalogService.findByName(user.getDeaconFamily2());
        if (family == null || family.getId() == null) return false;
        user.setDeaconFamily2Id(family.getId());
        return true;
    }

    private boolean fillThird(User user) {
        if (user.getDeaconFamily3Id() != null) return false;
        FamilyCatalog family = familyCatalogService.findByName(user.getDeaconFamily3());
        if (family == null || family.getId() == null) return false;
        user.setDeaconFamily3Id(family.getId());
        return true;
    }

    private boolean fillFourth(User user) {
        if (user.getDeaconFamily4Id() != null) return false;
        FamilyCatalog family = familyCatalogService.findByName(user.getDeaconFamily4());
        if (family == null || family.getId() == null) return false;
        user.setDeaconFamily4Id(family.getId());
        return true;
    }
}
